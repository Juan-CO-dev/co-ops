// Item 4 PR 2: the 0343 offline proof (PGlite, single session, synthetic fixtures only; no network, no sim,
// no prod). The REAL parents (0337 with its lease, users, the real audit_log), the REAL 0342 and the REAL 0343.
//  - ship state: the register is EMPTY, so every source is 'unverified';
//  - the gate in SQL: an unverified or revoked source writes nothing (no row, no run) and reads nothing;
//  - Astra r2 P2 #3: revoked AFTER rows were stored = the rows are kept and no reader returns them;
//    revoked between the fetch and the write = source_revoked, nothing written;
//  - who may mark (MoO+, audited who/when), what may be marked (never named_only / refuse);
//  - a changed definition is unverified again; dedup; the 224-row cap; manual events by GM+; the lease.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { M0337 } from "./helpers/fact-0337-parents";
import { freshLaborParents } from "./helpers/fact-0338-parents";

const M0342 = readFileSync("supabase/migrations/0342_demand_signals_replay.sql", "utf8");
const M0343 = readFileSync("supabase/migrations/0343_demand_signal_sources.sql", "utf8");
const SHOP_A = randomUUID(), SHOP_B = randomUUID();
const MOO = randomUUID(), OWNER = randomUUID(), GM_A = randomUUID(), AGM = randomUUID(), GONE = randomUUID();

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T = unknown>(sql: string, params: unknown[] = []) => Object.values((await q(sql, params))[0] as Record<string, T>)[0] as T;
const count = (table: string, where = "true") => one<number>(`select count(*)::int from ${table} where ${where}`);
const fails = async (p: Promise<unknown>, message: string) => { await expect(p).rejects.toThrow(message); };
async function as<T>(role: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec("reset role"); }
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const def = (over: Record<string, unknown> = {}) => JSON.stringify({
  adapter: { key: "nws", version: 1 }, category: "weather", cost: "free", gate: "allow_with_conditions",
  name: "Test weather", sourceId: "nws", termsQuote: "This data is open data, free to use for any purpose.", termsStatus: "verified", termsUrl: "https://example.test/terms", ...over });
const register = (text: string) => one<{ result: string; seq: number; definition_hash: string }>("select demand_source_register($1)", [text]);
const mark = (actor: string | null, source: string, hash: string, status: string, note = "read the terms page") =>
  one<{ event_seq: number; status: string }>("select demand_source_mark($1,$2,$3,$4,$5)", [actor, source, hash, status, note]);
const status = (source: string) => one<string>("select demand_source_status($1)", [source]);
const hourIso = (h: number) => { const d = new Date(Date.now() + h * 3_600_000); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };
const wx = (h: number, t = 57, extra: Record<string, unknown> = {}) =>
  ({ valid_hour: hourIso(h), temperature_f: t, precip_probability_pct: 10, wind_speed_mph: 5, relative_humidity_pct: 40, is_daytime: true, condition: "Sunny", ...extra });
const ingest = (hash: string | null, rows: unknown[], shop = SHOP_A, source = "nws") =>
  one<{ run_id: string; seen: number; written: number }>("select demand_weather_ingest($1,$2,$3,now(),now(),$4::jsonb)", [source, hash, shop, JSON.stringify(rows)]);
const usable = (shop = SHOP_A) => q<{ valid_hour: string; temperature_f: string; vintage_id: number }>(
  "select * from demand_usable_weather($1, now() - interval '1 hour', now() + interval '8 days', now() + interval '1 minute')", [shop]);
const event = (actor: string | null, o: Partial<{ loc: string | null; cat: string; from: string; to: string | null; title: string; impact: string; note: string | null; supersedes: string | null; retract: boolean }> = {}) =>
  one<{ id: string; retracted: boolean }>("select demand_event_save($1,$2,$3,$4::date,$5::date,null,null,$6,$7,$8,$9,$10)",
    [actor, o.loc === undefined ? SHOP_A : o.loc, o.cat ?? "sports_game", o.from ?? today, o.to ?? null, o.title ?? "Home game", o.impact ?? "up", o.note ?? null, o.supersedes ?? null, o.retract ?? false]);
let today: string;
let H1: string;

beforeAll(async () => {
  db = await freshLaborParents();
  await db.exec(`create table public.user_locations(user_id uuid not null, location_id uuid not null, active boolean not null default true, assigned_by uuid);`);
  await db.exec(M0342);
  await db.exec(M0343);
  today = String(await one("select demand_today_et()::text"));
  await db.query("insert into locations(id, name, active) values ($1,'Shop A',true), ($2,'Shop B',true)", [SHOP_A, SHOP_B]);
  await db.query(`insert into users(id, role, active) values ($1,'moo',true), ($2,'owner',true), ($3,'gm',true), ($4,'agm',true), ($5,'moo',false)`, [MOO, OWNER, GM_A, AGM, GONE]);
  await db.query("insert into user_locations(user_id, location_id, active) values ($1,$2,true), ($1,$3,false)", [GM_A, SHOP_A, SHOP_B]);
}, 240_000);

describe("0343: ship state and ceilings", () => {
  it("ships with an EMPTY register: no source, no status event, every source reads 'unverified'", async () => {
    expect(await count("demand_sources")).toBe(0);
    expect(await count("demand_source_events")).toBe(0);
    expect(await status("nws")).toBe("unverified");
    const body = M0343.replace(/^--.*$/gm, "");
    expect(body).not.toMatch(/insert into public\.demand_sources[\s\S]{0,40}values \('/i);
    expect(body).not.toMatch(/insert into public\.demand_source_events \([^)]*\)\s*values \('/i);
  });
  it("refuses a second apply by name", async () => {
    await fails(db.exec(M0343), "0343: already applied");
    await db.exec("rollback");
  });
  it("service_role reads and cannot write a table directly; PostgREST roles reach nothing", async () => {
    await as("service_role", async () => {
      for (const t of ["demand_sources", "demand_source_events", "demand_signal_runs", "demand_weather_hourly", "demand_day_events"]) {
        expect(await q(`select count(*) from ${t}`)).toHaveLength(1);
        await fails(q(`delete from ${t}`), "permission denied");
      }
      await fails(q("insert into demand_source_events(source_seq, source_id, status, actor_id, actor_role, note) values (1,'nws','verified',gen_random_uuid(),'moo','forged')"), "permission denied");
      await fails(q("update demand_sources set gate = 'allow'"), "permission denied");
    });
    for (const role of ["anon", "authenticated"]) {
      await as(role, async () => {
        await fails(q("select * from demand_sources"), "permission denied");
        await fails(q("select demand_source_status('nws')"), "permission denied");
        await fails(q("select demand_source_mark(gen_random_uuid(),'nws','x','verified','note here')"), "permission denied");
        await fails(q("select * from demand_usable_weather(gen_random_uuid(), now(), now(), now())"), "permission denied");
      });
    }
  });
  it("touches no existing object except the cron lease, whose body is 0337's with one job added", () => {
    const body = M0343.replace(/^--.*$/gm, "");
    expect(body).not.toMatch(/\bdrop\s+(table|function|policy|index|trigger)|\bdelete\s+from\s+public\./i);
    expect([...body.matchAll(/alter table public\.(\w+)/gi)].map((m) => m[1])).toEqual(["cron_route_leases"]);
    expect([...body.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1])).toEqual(["claim_cron_route"]);
    expect(body).not.toMatch(/par_auto_moves|vendor_items|schedule_|location_sku_settings|po_lines/);
    const fnOf = (sql: string) => { const at = sql.indexOf("create or replace function public.claim_cron_route("); const open = sql.indexOf("$$", at) + 2; return sql.slice(open, sql.indexOf("$$", open)); };
    expect(fnOf(M0343)).toBe(fnOf(M0337).replace("'meta-leads','fact-build')", "'meta-leads','fact-build','demand-signals')"));
    expect(fnOf(M0343)).not.toBe(fnOf(M0337));
  });
  it("the lease admits demand-signals and every job it admitted before", async () => {
    for (const job of ["toast-sales-today", "toast-catering-scan", "sevenshifts-sync", "schedule-draft", "catering-inbox-delivery", "meta-leads", "fact-build", "demand-signals"]) {
      expect(await one("select claim_cron_route($1)", [job])).toBe(true);
    }
    expect(await one("select claim_cron_route('demand-signals')")).toBe(false);
    await fails(q("select claim_cron_route('nope')"), "invalid_cron_route");
  });
});

describe("0343: the register", () => {
  it("names a definition by its recomputed hash and reads its columns from the text itself", async () => {
    const text = def();
    const r = await as("service_role", () => register(text));
    expect(r.result).toBe("registered");
    expect(r.definition_hash).toBe(sha(text));
    H1 = r.definition_hash;
    expect(await q("select source_id, gate, adapter, terms_status, cost from demand_sources")).toEqual([
      { source_id: "nws", gate: "allow_with_conditions", adapter: "nws@1", terms_status: "verified", cost: "free" }]);
    expect((await register(text)).result).toBe("exists");
    expect(await count("demand_sources")).toBe(1);
    expect(await status("nws")).toBe("unverified");
  });
  it("refuses a paid source, an ingestible gate over unread terms, and a 'verified' terms claim with no page", async () => {
    await fails(register(def({ sourceId: "paid_one", cost: "paid" })), "demand_sources_cost_check");
    await fails(register(def({ sourceId: "unread", termsStatus: "unverified", gate: "allow" })), "demand_sources_check");
    await fails(register(def({ sourceId: "no_page", termsUrl: undefined })), "source_terms_evidence_missing");
    await fails(register("not json"), "source_definition_invalid");
    await fails(register(JSON.stringify(["nws"])), "source_definition_invalid");
    expect((await register(def({ sourceId: "espn_site", gate: "refuse", termsStatus: "unverified", termsUrl: undefined, adapter: undefined, category: "sports" }))).result).toBe("registered");
    expect((await register(def({ sourceId: "opm_status", gate: "named_only", adapter: undefined, category: "government_status" }))).result).toBe("registered");
  });
});

describe("0343: terms evidence is the page AND the quote, in SQL (review r1 P2 #3)", () => {
  const forge = () => q(`insert into demand_sources (source_id, definition_hash, definition, name, category, cost, gate, terms_status, terms_url)
    values ('forged', $1, '{}', 'Forged', 'weather', 'free', 'allow', 'verified', 'https://example.test/terms')`, [sha("forged")]);
  it("registration as service_role refuses a 'verified' terms claim with no quote, a blank or short quote, or no page", async () => {
    const before = await count("demand_sources");
    await as("service_role", async () => {
      for (const over of [{ termsQuote: undefined }, { termsQuote: null }, { termsQuote: "   " }, { termsQuote: "too short" }, { termsQuote: 7 }, { termsUrl: undefined }, { termsUrl: null }]) {
        await fails(register(def({ sourceId: "no_evidence", ...over })), "source_terms_evidence_missing");
      }
    });
    expect(await count("demand_sources")).toBe(before);
    expect(await count("audit_log", "action = 'demand_source.register' and metadata->>'source_id' = 'no_evidence'")).toBe(0);
    // Terms nobody has read need no evidence (and can never be ingestible).
    expect((await register(def({ sourceId: "unread_feed", gate: "pending_terms", termsStatus: "unverified", termsQuote: null, termsUrl: undefined, adapter: undefined }))).result).toBe("registered");
    expect(await q("select terms_quote from demand_sources where source_id = 'nws'")).toEqual([{ terms_quote: "This data is open data, free to use for any purpose." }]);
  });
  it("the table itself refuses such a row, whoever writes it", async () => {
    await fails(forge(), "demand_sources_terms_evidence");
  });
  it("verification re-checks the evidence on the row it marks: a row without it can never be marked verified", async () => {
    try {
      await db.exec("begin; alter table public.demand_sources drop constraint demand_sources_terms_evidence;");
      await forge();
      await fails(mark(MOO, "forged", sha("forged"), "verified"), "source_terms_evidence_missing");
    } finally { await db.exec("rollback"); }
    expect(await count("demand_sources", "source_id = 'forged'")).toBe(0);
  });
});

describe("0343: the gate refuses an unverified source at every use", () => {
  it("collect: nothing is written, not even a run", async () => {
    await fails(ingest(H1, [wx(2)]), "source_unverified");
    await fails(q("select demand_events_ingest('nws',$1,$2,now(),$3::jsonb)", [H1, SHOP_A, JSON.stringify([{ external_key: "a1", category: "weather_alert", valid_from: today, valid_to: today, title: "Flood Watch" }])]), "source_unverified");
    await fails(ingest(H1, [wx(2)], SHOP_A, "never_registered"), "source_unverified");
    expect(await count("demand_weather_hourly")).toBe(0);
    expect(await count("demand_day_events")).toBe(0);
    expect(await count("demand_signal_runs")).toBe(0);
    await fails(q("select demand_sources_assert_usable(array['nws'])"), "source_unverified");
  });
});

describe("0343: marking is MoO+, named, and audited who and when", () => {
  it("refuses everyone below MoO, an inactive MoO and no actor", async () => {
    for (const actor of [GM_A, AGM, GONE, null, randomUUID()]) await fails(mark(actor, "nws", H1, "verified"), "demand_source_forbidden");
    expect(await count("demand_source_events")).toBe(0);
  });
  it("refuses by name: no note, an unknown source, a definition the person did not read, a source that is not ingestible", async () => {
    await fails(mark(MOO, "nws", H1, "verified", "  "), "demand_source_invalid");
    await fails(mark(MOO, "nws", H1, "approved"), "demand_source_invalid");
    await fails(mark(MOO, "nowhere", H1, "verified"), "source_unknown");
    await fails(mark(MOO, "nws", sha("other"), "verified"), "source_definition_moved");
    for (const id of ["espn_site", "opm_status"]) {
      const h = await one<string>("select definition_hash from demand_source_states() where source_id = $1", [id]);
      await fails(mark(OWNER, id, h, "verified"), "source_not_ingestible");
    }
  });
  it("a MoO verifies it: one event, one destructive audit row with who and which definition, never the note", async () => {
    const r = await as("service_role", () => mark(MOO, "nws", H1, "verified", "Read weather.gov disclaimer 2026-11-18"));
    expect(r.status).toBe("verified");
    expect(await status("nws")).toBe("verified");
    const ev = await q<{ actor_id: string; actor_role: string; status: string; created_at: string }>("select actor_id, actor_role, status, created_at from demand_source_events");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor_id: MOO, actor_role: "moo", status: "verified" });
    expect(ev[0]!.created_at).toBeTruthy();
    const audit = await q<{ actor_id: string; destructive: boolean; metadata: Record<string, unknown>; after_state: unknown }>(
      "select actor_id, destructive, metadata, after_state from audit_log where action = 'demand_source.mark'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: MOO, destructive: true, after_state: { status: "verified" },
      metadata: { source_id: "nws", definition_hash: H1, has_note: true } });
    expect(JSON.stringify(audit[0])).not.toContain("disclaimer");
    await fails(mark(OWNER, "nws", H1, "verified"), "source_status_unchanged");
  });
});

describe("0343: a verified source is stored as vintages", () => {
  it("writes typed rows and a run; an unchanged fetch writes a run and no row", async () => {
    const first = await as("service_role", () => ingest(H1, [wx(2), wx(3, 58), wx(4, 59, { precip_probability_pct: null, wind_speed_mph: null, relative_humidity_pct: null })]));
    expect(first).toMatchObject({ seen: 3, written: 3 });
    expect(await ingest(H1, [wx(2), wx(3, 58)])).toMatchObject({ seen: 2, written: 0 });
    expect(await count("demand_weather_hourly")).toBe(3);
    expect(await q("select outcome, rows_seen, rows_written from demand_signal_runs order by finished_at")).toEqual([
      { outcome: "written", rows_seen: 3, rows_written: 3 }, { outcome: "unchanged", rows_seen: 2, rows_written: 0 }]);
  });
  it("a changed hour is a NEW vintage beside the old one, and the reader returns the latest as of the asking time", async () => {
    const before = await one<string>("select clock_timestamp()::text");
    expect(await ingest(H1, [wx(2, 61)])).toMatchObject({ written: 1 });
    expect(await count("demand_weather_hourly", `valid_hour = '${hourIso(2)}'`)).toBe(2);
    const now = await usable();
    expect(now).toHaveLength(3);
    expect(Number(now.find((r) => new Date(r.valid_hour).toISOString() === hourIso(2))!.temperature_f)).toBe(61);
    const then = await q<{ temperature_f: string }>("select temperature_f from demand_usable_weather($1, now() - interval '1 hour', now() + interval '8 days', $2::timestamptz) where valid_hour = $3", [SHOP_A, before, hourIso(2)]);
    expect(Number(then[0]!.temperature_f)).toBe(57);
    expect(await usable(SHOP_B)).toEqual([]);
  });
  it("refuses a run over 224 rows, a half hour, a duplicate hour and a stale hour, writing nothing", async () => {
    const rows = await count("demand_weather_hourly"), runs = await count("demand_signal_runs");
    await fails(ingest(H1, Array.from({ length: 225 }, (_, i) => wx(i % 150))), "rows_over_cap");
    await fails(ingest(H1, [{ ...wx(5), valid_hour: new Date(new Date(hourIso(5)).getTime() + 1_800_000).toISOString() }]), "weather_rows_invalid");
    await fails(ingest(H1, [wx(5), wx(5, 70)]), "weather_rows_invalid");
    await fails(ingest(H1, [wx(-30)]), "weather_rows_invalid");
    await fails(ingest(H1, [wx(24 * 9)]), "weather_rows_invalid");
    await fails(ingest(H1, [wx(5, 500)]), "demand_weather_hourly_temperature_f_check");
    await fails(ingest(null, [wx(5)]), "source_unverified");
    await fails(ingest(sha("an older adapter"), [wx(5)]), "source_unverified");
    expect(await count("demand_weather_hourly")).toBe(rows);
    expect(await count("demand_signal_runs")).toBe(runs);
  });
  it("feed events: stored once per content, the latest vintage per event is what a reader gets", async () => {
    const ev = (title: string) => JSON.stringify([{ external_key: "urn:alert:1", category: "weather_alert", valid_from: today, valid_to: today, title, severity: "severe", issued_at: new Date().toISOString() }]);
    const put = (title: string) => one<{ written: number }>("select demand_events_ingest('nws',$1,$2,now(),$3::jsonb)", [H1, SHOP_A, ev(title)]);
    expect(await put("Winter Storm Watch")).toMatchObject({ written: 1 });
    expect(await put("Winter Storm Watch")).toMatchObject({ written: 0 });
    expect(await put("Winter Storm Warning")).toMatchObject({ written: 1 });
    const got = await q<{ title: string; origin: string }>("select title, origin from demand_usable_day_events($1, $2::date, $2::date, now() + interval '1 minute')", [SHOP_A, today]);
    expect(got).toEqual([{ title: "Winter Storm Warning", origin: "feed" }]);
    await fails(q("select demand_events_ingest('nws',$1,$2,now(),$3::jsonb)", [H1, SHOP_A, JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ external_key: `k${i}`, category: "weather_alert", valid_from: today, valid_to: today, title: "Alert" })))]), "rows_over_cap");
  });
});

describe("0343: A CANCELLED ALERT STOPS BEING USABLE (review r1 P2 #1)", () => {
  const tomorrow = () => one<string>("select (demand_today_et() + 1)::text");
  const snapshot = (events: unknown[], shop = SHOP_A) => one<{ seen: number; written: number; withdrawn: number }>("select demand_events_ingest('nws',$1,$2,now(),$3::jsonb)", [H1, shop, JSON.stringify(events)]);
  const read = (day: string, asOf = "now() + interval '1 minute'") => q<{ title: string }>(
    `select title from demand_usable_day_events($1, $2::date, $2::date, ${asOf}) where origin = 'feed' order by title`, [SHOP_A, day]);
  const live: Record<string, unknown> = { external_key: "urn:alert:1", category: "weather_alert", title: "Winter Storm Warning", severity: "severe" };
  let watch: Record<string, unknown>;
  it("collect, then the alert leaves the feed before its end: the reader stops returning it; the earlier view still has it", async () => {
    const day = await tomorrow();
    Object.assign(live, { valid_from: today, valid_to: today });
    watch = { external_key: "urn:alert:watch", category: "weather_alert", valid_from: day, valid_to: day, title: "Flood Watch", severity: "moderate",
      issued_at: new Date().toISOString(), ends_at: new Date(Date.now() + 40 * 3_600_000).toISOString() };
    expect(await snapshot([live, watch])).toMatchObject({ seen: 2, written: 1, withdrawn: 0 });
    expect(await read(day)).toEqual([{ title: "Flood Watch" }]);
    const beforeCancel = await one<string>("select clock_timestamp()::text");
    const stored = await count("demand_day_events", "origin = 'feed'");
    // The next successful collection no longer lists the watch (cancelled, or replaced by an update).
    expect(await as("service_role", () => snapshot([live]))).toMatchObject({ seen: 1, written: 0, withdrawn: 1 });
    expect(await read(day)).toEqual([]);
    expect(await read(today)).toEqual([{ title: "Winter Storm Warning" }]);
    // History: as of the instant before the cancellation the watch is still what we knew. Nothing was deleted.
    expect(await read(day, `'${beforeCancel}'::timestamptz`)).toEqual([{ title: "Flood Watch" }]);
    expect(await count("demand_day_events", "origin = 'feed'")).toBe(stored + 1);
    expect(await q("select withdrawn, title from demand_day_events where external_key = 'urn:alert:watch' order by seq")).toEqual([
      { withdrawn: false, title: "Flood Watch" }, { withdrawn: true, title: "Flood Watch" }]);
    expect(await q("select outcome, rows_seen, rows_written, rows_withdrawn from demand_signal_runs where feed = 'day_events' order by finished_at desc limit 1"))
      .toEqual([{ outcome: "written", rows_seen: 1, rows_written: 0, rows_withdrawn: 1 }]);
  });
  it("a withdrawal is written once; the alert coming back is a new vintage and is usable again", async () => {
    const day = await tomorrow();
    expect(await snapshot([live])).toMatchObject({ written: 0, withdrawn: 0 });
    expect(await count("demand_day_events", "external_key = 'urn:alert:watch' and withdrawn")).toBe(1);
    expect(await snapshot([live, watch])).toMatchObject({ written: 1, withdrawn: 0 });
    expect(await read(day)).toEqual([{ title: "Flood Watch" }]);
    expect(await snapshot([live])).toMatchObject({ withdrawn: 1 });
    expect(await read(day)).toEqual([]);
  });
  it("an alert that ran its course (its end has passed) is history, not a cancellation: leaving the feed withdraws nothing", async () => {
    const over = { external_key: "urn:alert:over", category: "weather_alert", valid_from: today, valid_to: today, title: "Dense Fog Advisory", severity: "minor",
      ends_at: new Date(Date.now() - 3_600_000).toISOString() };
    expect(await snapshot([live, over])).toMatchObject({ written: 1 });
    expect(await snapshot([live])).toMatchObject({ written: 0, withdrawn: 0 });
    expect(await read(today)).toEqual([{ title: "Dense Fog Advisory" }, { title: "Winter Storm Warning" }]);
  });
  it("only a COMPLETE successful snapshot of THAT shop withdraws: a refused or failed fetch leaves every alert as it was", async () => {
    await fails(snapshot([{ external_key: "bad" }]), "events_invalid");
    await one("select demand_signal_run_fail('nws',$1,'day_events',now(),'http_error')", [SHOP_A]);
    expect(await snapshot([], SHOP_B)).toMatchObject({ seen: 0, written: 0, withdrawn: 0 });
    expect(await read(today)).toEqual([{ title: "Dense Fog Advisory" }, { title: "Winter Storm Warning" }]);
  });
  it("a manual entry can never be a withdrawal", async () => {
    await fails(q(`insert into demand_day_events (origin, location_id, category, valid_from, valid_to, title, expected_impact, content_hash, created_by, withdrawn)
      values ('manual', $1, 'other', $2::date, $2::date, 'Forged', 'unknown', $3, $4, true)`, [SHOP_A, today, sha("x"), MOO]), "demand_day_events_feed_withdrawal");
  });
});

describe("0343: REVOKING A SOURCE STOPS USE OF WHAT IS ALREADY STORED (Astra r2 P2 #3)", () => {
  let stored: number, storedEvents: number;
  it("render saw it, then it was revoked: the accept check answers source_revoked", async () => {
    stored = await count("demand_weather_hourly"); storedEvents = await count("demand_day_events", "origin = 'feed'");
    await q("select demand_sources_assert_usable(array['nws'])");             // display: usable
    expect((await usable()).length).toBeGreaterThan(0);
    await mark(OWNER, "nws", H1, "revoked", "Terms changed; stop using it");
    await fails(q("select demand_sources_assert_usable(array['nws'])"), "source_revoked"); // accept: refused
    await fails(q("select demand_sources_assert_usable(array['nws','nws'])"), "source_revoked");
    await q("select demand_sources_assert_usable(array[]::text[])");           // a zero-feed signal has no source
  });
  it("compute and render: no stored row of the revoked source is returned, and none was deleted", async () => {
    expect(await usable()).toEqual([]);
    expect(await q("select * from demand_usable_day_events($1, $2::date, $2::date, now() + interval '1 minute') where origin = 'feed'", [SHOP_A, today])).toEqual([]);
    expect(await count("demand_weather_hourly")).toBe(stored);
    expect(await count("demand_day_events", "origin = 'feed'")).toBe(storedEvents);
  });
  it("collect: fetched while verified, revoked before the write = source_revoked and nothing written", async () => {
    const runs = await count("demand_signal_runs");
    await fails(ingest(H1, [wx(6)]), "source_revoked");
    expect(await count("demand_weather_hourly")).toBe(stored);
    expect(await count("demand_signal_runs")).toBe(runs);
  });
  it("a person can verify it again (a new event); the history of both decisions stays", async () => {
    await mark(MOO, "nws", H1, "verified", "Terms re-read, fine");
    expect((await usable()).length).toBeGreaterThan(0);
    expect(await q("select status from demand_source_events where source_id = 'nws' order by seq")).toEqual([{ status: "verified" }, { status: "revoked" }, { status: "verified" }]);
  });
  it("a CHANGED definition (endpoint, adapter version, terms) is unverified again, for collection and for use", async () => {
    const r = await register(def({ adapter: { key: "nws", version: 2 } }));
    expect(r.result).toBe("redefined");
    expect(await status("nws")).toBe("unverified");
    await fails(ingest(H1, [wx(6)]), "source_unverified");
    await fails(ingest(r.definition_hash, [wx(6)]), "source_unverified");
    expect(await usable()).toEqual([]);
    expect(await count("demand_weather_hourly")).toBe(stored);
    await fails(mark(MOO, "nws", H1, "verified"), "source_definition_moved");
    await mark(MOO, "nws", r.definition_hash, "verified", "v2 adapter reviewed");
    expect((await ingest(r.definition_hash, [wx(6)])).written).toBe(1);
    expect((await usable()).length).toBe(4);   // three hours before, one new hour; the superseded vintage of hour 2 is not returned
  });
  it("a failed run is recorded with a fixed code and stores no signal", async () => {
    const id = await as("service_role", () => one<string>("select demand_signal_run_fail('nws',$1,'weather_hourly',now(),'http_error')", [SHOP_B]));
    expect(await q("select outcome, error_code, rows_written from demand_signal_runs where id = $1", [id])).toEqual([{ outcome: "failed", error_code: "http_error", rows_written: 0 }]);
    await fails(q("select demand_signal_run_fail('nws',$1,'weather_hourly',now(),'Bad Message!')", [SHOP_B]), "demand_signal_runs_error_code_check");
  });
});

describe("0343: manual events by GM+ (the page is PR 5)", () => {
  let first: string;
  it("a GM records one for their own shop; never another shop, never all shops; below GM never", async () => {
    first = (await as("service_role", () => event(GM_A, { note: "Nationals home opener" }))).id;
    await fails(event(GM_A, { loc: SHOP_B }), "demand_event_shop_forbidden");   // an INACTIVE membership is no membership
    await fails(event(GM_A, { loc: null }), "demand_event_shop_forbidden");
    for (const actor of [AGM, GONE, null]) await fails(event(actor), "demand_event_forbidden");
    expect(await q("select origin, created_by, source_id, scope_key = location_id::text as scoped from demand_day_events where id = $1", [first]))
      .toEqual([{ origin: "manual", created_by: GM_A, source_id: null, scoped: true }]);
  });
  it("MoO+ records for any shop or for all shops (scope_key 'all')", async () => {
    const all = await event(MOO, { loc: null, cat: "government_closure", title: "Federal offices closed", impact: "down" });
    expect(await one("select scope_key from demand_day_events where id = $1", [all.id])).toBe("all");
    await event(OWNER, { loc: SHOP_B, cat: "race", title: "5K on P Street" });
    const seen = await q<{ title: string }>("select title from demand_usable_day_events($1, $2::date, $2::date, now() + interval '1 minute') where origin = 'manual' order by title", [SHOP_B, today]);
    expect(seen.map((r) => r.title)).toEqual(["5K on P Street", "Federal offices closed"]);
  });
  it("refuses a bad shape by name", async () => {
    await fails(event(MOO, { cat: "party" }), "demand_event_invalid");
    await fails(event(MOO, { title: "x" }), "demand_event_invalid");
    await fails(event(MOO, { impact: "huge" }), "demand_event_invalid");
    await fails(event(MOO, { from: "2026-01-10", to: "2026-01-01" }), "demand_event_invalid");
    await fails(event(MOO, { from: "2020-01-01" }), "demand_event_invalid");
    await fails(event(MOO, { retract: true }), "demand_event_invalid");
    await fails(event(MOO, { loc: randomUUID() }), "demand_event_invalid");
  });
  it("a correction supersedes the head once; a second correction of the same row is demand_event_moved", async () => {
    const second = await event(GM_A, { title: "Home game (7 PM)", supersedes: first });
    await fails(event(MOO, { title: "Home game (1 PM)", supersedes: first }), "demand_event_moved");
    const seen = await q<{ id: string; title: string }>("select id, title from demand_usable_day_events($1, $2::date, $2::date, now() + interval '1 minute') where origin = 'manual' and category = 'sports_game'", [SHOP_A, today]);
    expect(seen).toEqual([{ id: second.id, title: "Home game (7 PM)" }]);
    const gone = await event(MOO, { supersedes: second.id, retract: true });
    expect(gone.retracted).toBe(true);
    expect(await q("select * from demand_usable_day_events($1, $2::date, $2::date, now() + interval '1 minute') where origin = 'manual' and category = 'sports_game'", [SHOP_A, today])).toEqual([]);
    await fails(event(MOO, { supersedes: gone.id, title: "Back again" }), "demand_event_moved");
    expect(await count("demand_day_events", "origin = 'manual' and category = 'sports_game'")).toBe(3);   // nothing deleted
  });
  it("audits a new entry as non-destructive and a correction as destructive; the title and the note never enter the row", async () => {
    const rows = await q<{ action: string; destructive: boolean; metadata: Record<string, unknown> }>(
      "select action, destructive, metadata from audit_log where action like 'demand_event.%' order by occurred_at");
    expect(rows.filter((r) => r.action === "demand_event.record").every((r) => r.destructive === false)).toBe(true);
    expect(rows.filter((r) => r.action === "demand_event.correct").map((r) => r.destructive)).toEqual([true, true]);
    expect(JSON.stringify(rows)).not.toMatch(/Home game|Nationals|5K/);
    expect(rows[0]!.metadata).toMatchObject({ category: "sports_game", has_note: true });
  });
  it("a manual event has no source, so no revocation hides it", async () => {
    const h = await one<string>("select definition_hash from demand_source_states() where source_id = 'nws'");
    await mark(MOO, "nws", h, "revoked", "testing revocation again");
    const seen = await q("select 1 from demand_usable_day_events($1, $2::date, $2::date, now() + interval '1 minute') where origin = 'manual'", [SHOP_B, today]);
    expect(seen.length).toBe(2);
  });
});

describe("0343: the event read is totally ordered, so it can be paged (review r1 P2 #2)", () => {
  it("returns manual and feed rows by (valid_from, id), the same on every call and across pages", async () => {
    const h = await one<string>("select definition_hash from demand_source_states() where source_id = 'nws'");
    await mark(MOO, "nws", h, "verified", "back on for the ordering proof");
    for (let i = 0; i < 12; i++) await event(MOO, { cat: "other", title: `Paging ${i}`, from: today, impact: "unknown" });
    const call = "demand_usable_day_events($1, $2::date, ($2::date + 30), now() + interval '1 minute')";
    const all = await q<{ id: string; origin: string }>(`select id, origin from ${call}`, [SHOP_A, today]);
    expect(all.length).toBeGreaterThanOrEqual(14);
    expect(new Set(all.map((r) => r.origin))).toEqual(new Set(["manual", "feed"]));
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    const sorted = await q<{ id: string }>(`select id from ${call} order by valid_from, id`, [SHOP_A, today]);
    expect(all.map((r) => r.id)).toEqual(sorted.map((r) => r.id));
    const pages = [...await q<{ id: string }>(`select id from ${call} limit 5 offset 0`, [SHOP_A, today]), ...await q<{ id: string }>(`select id from ${call} limit 500 offset 5`, [SHOP_A, today])];
    expect(pages.map((r) => r.id)).toEqual(all.map((r) => r.id));
    const fn = M0343.slice(M0343.indexOf("create function public.demand_usable_day_events("));
    expect(fn.slice(0, fn.indexOf("end $$;"))).toMatch(/order by u\.valid_from, u\.id;\s*$/);
  });
});
