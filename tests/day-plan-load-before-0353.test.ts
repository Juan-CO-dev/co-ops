/**
 * Nav PR 6 (plan r3, 4.3 and 8.5): everything works BEFORE 0353 is applied, and the apply moves nothing.
 *  - The flag read, end to end on PGlite (the real `loadStationDayFlags` through tests/helpers/pglite-postgrest.ts,
 *    which returns the database's own error where PostgREST would): no columns → not installed; the real 0353 file →
 *    installed, with the backfilled ids; a mark → its station.
 *  - The flag read on the recording client: which errors mean "not installed", which throw.
 *  - The writers before the apply: the function is missing → 503 station_flags_unavailable.
 */
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";
import { AssignmentError, loadStationDayFlags, saveStationNotPhase } from "@/lib/assignments";
import { notPhaseSections, pickEffectiveClosingTemplate, type ClassificationItem, type ClosingTemplateRow } from "@/lib/day-plan-load-shared";
import { fakeSupabase } from "./helpers/fake-supabase";
import { pgliteClient } from "./helpers/pglite-postgrest";
import {
  CLOSING_MANAGER, id, LIVE_SECTIONS, liveShop, merge, readMigration, SCHEMA, seed, SHOP_C, SHOP_P, twinShapes, versionShop,
} from "../scripts/sql-harness-0353-lib.mjs";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const M0353 = readMigration("0353_station_day_flags.sql");
const P_TPL = id(11), C_TPL = id(12);
const P = (name: string) => id(100 + LIVE_SECTIONS.indexOf(name));
const C = (name: string) => id(200 + LIVE_SECTIONS.indexOf(name));
const GM = id(31);

async function liveDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await seed(db, merge(liveShop(SHOP_P, "P", P_TPL, { stationBase: 100 }), liveShop(SHOP_C, "C", C_TPL, { stationBase: 200 }),
    { users: [{ id: GM, role: "gm" }], memberships: [{ user: GM, location: SHOP_P }] }));
  return db;
}

describe("the flag read on PGlite: before and after the real 0353", () => {
  it("no columns → not installed; after 0353 → installed with Closing Manager backfilled; a mark → its station", async () => {
    const db = await liveDb();
    try {
      const sb = pgliteClient(db);
      expect(await loadStationDayFlags(sb, SHOP_P)).toEqual({ installed: false });
      await db.exec(M0353);
      expect(await loadStationDayFlags(sb, SHOP_P)).toEqual({ installed: true, midDayStationId: null, notPhaseIds: new Set([P(CLOSING_MANAGER)]) });
      expect(await loadStationDayFlags(sb, SHOP_C)).toEqual({ installed: true, midDayStationId: null, notPhaseIds: new Set([C(CLOSING_MANAGER)]) });
      const marked = await sb.rpc("set_station_mid_day_trigger", { p_actor_id: GM, p_location_id: SHOP_P, p_station_id: P("Crunchy Boi Station"), p_on: true });
      expect(marked.error).toBeNull();
      expect(await loadStationDayFlags(sb, SHOP_P)).toEqual({ installed: true, midDayStationId: P("Crunchy Boi Station"), notPhaseIds: new Set([P(CLOSING_MANAGER)]) });
    } finally { await db.close(); }
  }, 60_000);
});

describe("the flag read on the recording client", () => {
  const run = (answer: { data?: unknown; error?: unknown }) => loadStationDayFlags(fakeSupabase(() => answer).client as never, SHOP_P);
  it("42703, PGRST204 and a message naming either column → not installed", async () => {
    for (const error of [
      { code: "42703", message: "column stations.starts_mid_day does not exist" },
      { code: "PGRST204", message: "Could not find the column" },
      { code: "XX000", message: "column \"not_phase_station\" does not exist" },
    ]) expect(await run({ error }), JSON.stringify(error)).toEqual({ installed: false });
  });
  it("any other error throws (the stations fact fails); two marked stations throw", async () => {
    await expect(run({ error: { code: "08006", message: "connection failure" } })).rejects.toThrow(/loadStationDayFlags: 08006/);
    await expect(run({ data: [{ id: "a", starts_mid_day: true, not_phase_station: false }, { id: "b", starts_mid_day: true, not_phase_station: false }] }))
      .rejects.toThrow(/more than one mid-day station/);
  });
  it("selects both columns in ONE read and never filters on them", async () => {
    const f = fakeSupabase(() => ({ data: [] }));
    await loadStationDayFlags(f.client as never, SHOP_P);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.arg("select")).toBe("id, starts_mid_day, not_phase_station");
    expect(f.calls[0]!.ops.filter((o) => o.op !== "select").map((o) => o.args[0])).toEqual(["location_id"]);
  });
});

describe("the writers before the apply", () => {
  it("the RPC is missing (PGRST202) → 503 station_flags_unavailable, no audit", async () => {
    const f = fakeSupabase((c) => c.table === "stations" ? { data: { id: P("Expo Station"), active: true, staffed: true } } : { data: [{ active: true }] },
      () => ({ error: { code: "PGRST202", message: "Could not find the function public.set_station_not_phase" } }));
    const err = await saveStationNotPhase(f.client as never, { actor: { userId: GM, role: "gm", level: 7, locations: [SHOP_P] }, locationId: SHOP_P, stationId: P("Expo Station"), on: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AssignmentError);
    expect(err).toMatchObject({ code: "station_flags_unavailable", status: 503 });
  });
});

// ── The twin test: the code rule (S3a + notPhaseSections) = the 0353 backfill, on the same rows ─────────────────────

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

/** The code rule over the database's rows: the effective closing template's ACTIVE items → the not-phase names. */
async function codeRule(db: PGlite, shop: string): Promise<Set<string>> {
  const templates = (await db.query<ClosingTemplateRow>("select id, type, active, effective_from::text as effective_from, created_at::text as created_at from checklist_templates where location_id = $1 and type = 'closing' and active", [shop])).rows;
  const effective = pickEffectiveClosingTemplate(templates, TODAY);
  if (effective === null) return new Set();
  const items = (await db.query<ClassificationItem>("select station, active, report_reference_type from checklist_template_items where template_id = $1 and active", [effective])).rows;
  const sections = notPhaseSections(items);
  const names = (await db.query<{ name: string }>("select name from stations where location_id = $1", [shop])).rows.map((r) => r.name);
  return new Set(names.filter((n) => sections.has(n)));
}
const backfilled = async (db: PGlite, shop: string) =>
  new Set((await db.query<{ name: string }>("select name from stations where location_id = $1 and not_phase_station", [shop])).rows.map((r) => r.name));

describe("twin: the code fallback equals the 0353 backfill", () => {
  it("over every section shape (0 refs; 1 of 1; 1 of 7; 5 of 7; inactive only; retired only; future only; other shop only; spaced name; a ref-less Closing Manager)", async () => {
    const { shapes, spec } = twinShapes();
    const db = new PGlite();
    try {
      await db.exec(SCHEMA);
      await seed(db, spec);
      const before = { p: await codeRule(db, SHOP_P), c: await codeRule(db, SHOP_C) };
      expect([...before.p].sort()).toEqual(shapes.filter((s) => s.expected).map((s) => s.name).sort());
      await db.exec(M0353);
      expect(await backfilled(db, SHOP_P)).toEqual(before.p);
      expect(await backfilled(db, SHOP_C)).toEqual(before.c);
      expect(before.c).toEqual(new Set(["Other shop ref only"]));
    } finally { await db.close(); }
  }, 60_000);

  it("the live shape: Closing Manager at both shops, nothing else, before and after", async () => {
    const db = await liveDb();
    try {
      const before = { p: await codeRule(db, SHOP_P), c: await codeRule(db, SHOP_C) };
      expect(before).toEqual({ p: new Set([CLOSING_MANAGER]), c: new Set([CLOSING_MANAGER]) });
      await db.exec(M0353);
      expect({ p: await backfilled(db, SHOP_P), c: await backfilled(db, SHOP_C) }).toEqual(before);
    } finally { await db.close(); }
  }, 60_000);

  it.each([["a", ["Closing Manager", "Expo Station"]], ["b", []]] as const)("ruling B1, V1 instance / V2 effective (%s): classified by V2, before and after", async (variant, want) => {
    const db = new PGlite();
    try {
      await db.exec(SCHEMA);
      await seed(db, versionShop(variant, { today: TODAY }));
      const before = await codeRule(db, SHOP_P);
      expect([...before].sort()).toEqual([...want].sort());
      await db.exec(M0353);
      expect(await backfilled(db, SHOP_P)).toEqual(before);
    } finally { await db.close(); }
  }, 60_000);
});
