/**
 * The two 0240 writers against a recording fake client:
 *   Astra #1 — the layout save never upserts; existing rows are UPDATEd with exactly the four permitted
 *              columns and only missing rows are INSERTed (0240 grants no UPDATE on the key columns).
 *   Astra #6 — a handoff note is superseded only by its author or a HIGHER level.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));

import { audit } from "@/lib/audit";
import { saveStationLayout, LayoutError } from "@/lib/pulse/layout";
import { supersedeHandoffNote, loadHandoffNotes, HandoffError } from "@/lib/pulse/handoff";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const S2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const NOTE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor = (level: number, id = "me", locations = [SHOP]): AuthContext => ({
  user: { id, role: "gm", language: "en" } as AuthContext["user"], session: {} as AuthContext["session"],
  role: level >= 9 ? "owner" : level >= 8 ? "moo" : level >= 7 ? "gm" : level >= 6 ? "agm" : "key_holder", level, locations,
});

/** A recording PostgREST-ish fake: every call chain is logged; responses are queued per table + verb. */
type Call = { table: string; verb: string; payload?: unknown; filters: Array<[string, unknown]> };
function fakeService(responses: Record<string, Array<{ data: unknown; error: unknown }>>) {
  const calls: Call[] = [];
  const next = (key: string) => responses[key]?.shift() ?? { data: null, error: null };
  const from = (table: string) => {
    const make = (verb: string, payload?: unknown) => {
      const call: Call = { table, verb, payload, filters: [] };
      calls.push(call);
      const result = next(`${table}.${verb}`);
      const q: Record<string, unknown> = {
        eq: (c: string, v: unknown) => { call.filters.push([c, v]); return q; },
        in: (c: string, v: unknown) => { call.filters.push([c, v]); return q; },
        is: (c: string, v: unknown) => { call.filters.push([c, v]); return q; },
        order: () => q, limit: () => q, select: () => q, returns: () => q,
        maybeSingle: async () => result, single: async () => result,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej),
      };
      return q;
    };
    return {
      select: (cols?: string) => make("select", cols),
      insert: (rows: unknown) => make("insert", rows),
      update: (patch: unknown) => make("update", patch),
      upsert: (rows: unknown) => make("upsert", rows),
    };
  };
  return { client: { from } as never, calls };
}

beforeEach(() => vi.clearAllMocks());

describe("Astra #1 — layout writer respects 0240's column grants", () => {
  it("existing rows are UPDATEd with exactly x, y, updated_by, updated_at; new rows are INSERTed; never upsert", async () => {
    const { client, calls } = fakeService({
      "stations.select": [{ data: [{ id: S1 }, { id: S2 }], error: null }],
      "pulse_station_layouts.select": [{ data: [{ station_id: S1, x: 0, y: 0 }], error: null }],
      "pulse_station_layouts.update": [{ data: [{ station_id: S1 }], error: null }],
    });
    const out = await saveStationLayout(client, actor(7), { locationId: SHOP, layout: { [S1]: { x: 2, y: 1 }, [S2]: { x: 1, y: 1 } }, ip: null, userAgent: null });
    expect(out).toEqual({ saved: 2 });
    expect(calls.some((c) => c.verb === "upsert")).toBe(false);
    const insert = calls.find((c) => c.table === "pulse_station_layouts" && c.verb === "insert")!;
    expect(insert.payload).toEqual([expect.objectContaining({ location_id: SHOP, station_id: S2, x: 1, y: 1, updated_by: "me" })]);
    const update = calls.find((c) => c.table === "pulse_station_layouts" && c.verb === "update")!;
    expect(Object.keys(update.payload as object).sort()).toEqual(["updated_at", "updated_by", "x", "y"]);
    expect(update.filters).toEqual([["location_id", SHOP], ["station_id", S1]]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "station.layout_update", metadata: expect.objectContaining({ stations: 2 }) }));
  });
  it("an unchanged existing point writes nothing; a zero-rowcount update is an error, never a silent success", async () => {
    const quiet = fakeService({
      "stations.select": [{ data: [{ id: S1 }], error: null }],
      "pulse_station_layouts.select": [{ data: [{ station_id: S1, x: 2, y: 1 }], error: null }],
    });
    await saveStationLayout(quiet.client, actor(7), { locationId: SHOP, layout: { [S1]: { x: 2, y: 1 } }, ip: null, userAgent: null });
    expect(quiet.calls.filter((c) => c.table === "pulse_station_layouts" && c.verb !== "select")).toEqual([]);
    const denied = fakeService({
      "stations.select": [{ data: [{ id: S1 }], error: null }],
      "pulse_station_layouts.select": [{ data: [{ station_id: S1, x: 0, y: 0 }], error: null }],
      "pulse_station_layouts.update": [{ data: [], error: null }],
    });
    await expect(saveStationLayout(denied.client, actor(7), { locationId: SHOP, layout: { [S1]: { x: 2, y: 1 } }, ip: null, userAgent: null })).rejects.toThrow(/no row/);
  });
  it("writes keep the OPERATIONAL bind: a level-8 reader of another shop may not save its layout", async () => {
    const { client, calls } = fakeService({});
    await expect(saveStationLayout(client, actor(8, "moo", [OTHER]), { locationId: SHOP, layout: {}, ip: null, userAgent: null })).rejects.toBeInstanceOf(LayoutError);
    expect(calls).toEqual([]);
  });
});

describe("Astra #6 — supersede only by the author or a higher level", () => {
  const noteBy = (authorId: string, authorRole: string) => ({
    "pulse_handoff_notes.select": [{ data: { id: NOTE, author_id: authorId }, error: null }],
    "users.select": [{ data: { role: authorRole }, error: null }],
    "pulse_handoff_notes.update": [{ data: [{ id: NOTE }], error: null }],
  });
  it("an AGM cannot retract a GM's or an owner's note (403 not_author_or_higher) and no UPDATE is attempted", async () => {
    for (const role of ["gm", "owner", "agm"]) {
      const { client, calls } = fakeService(noteBy("author", role));
      await expect(supersedeHandoffNote(client, actor(6), { locationId: SHOP, noteId: NOTE, ip: null, userAgent: null })).rejects.toMatchObject({ status: 403, code: "not_author_or_higher" });
      expect(calls.some((c) => c.verb === "update")).toBe(false);
    }
  });
  it("the author retracts their own note; a strictly higher level retracts anyone's; an unknown author level refuses", async () => {
    const own = fakeService({ "pulse_handoff_notes.select": [{ data: { id: NOTE, author_id: "me" }, error: null }], "pulse_handoff_notes.update": [{ data: [{ id: NOTE }], error: null }] });
    expect(await supersedeHandoffNote(own.client, actor(6), { locationId: SHOP, noteId: NOTE, ip: null, userAgent: null })).toEqual({ changed: true });
    expect(own.calls.some((c) => c.table === "users")).toBe(false); // own note: no level lookup needed
    const higher = fakeService(noteBy("author", "agm"));
    expect(await supersedeHandoffNote(higher.client, actor(7), { locationId: SHOP, noteId: NOTE, ip: null, userAgent: null })).toEqual({ changed: true });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "handoff.note_supersede" }));
    const unknown = fakeService({ "pulse_handoff_notes.select": [{ data: { id: NOTE, author_id: "ghost" }, error: null }], "users.select": [{ data: null, error: null }] });
    await expect(supersedeHandoffNote(unknown.client, actor(9), { locationId: SHOP, noteId: NOTE, ip: null, userAgent: null })).rejects.toBeInstanceOf(HandoffError);
  });
  it("a note from another shop is 404 before any authorship check", async () => {
    const { client, calls } = fakeService({ "pulse_handoff_notes.select": [{ data: null, error: null }] });
    await expect(supersedeHandoffNote(client, actor(9, "own", []), { locationId: SHOP, noteId: NOTE, ip: null, userAgent: null })).rejects.toMatchObject({ status: 404 });
    expect(calls.filter((c) => c.verb === "update")).toEqual([]);
  });
});

describe("Astra #5 — handoff READ uses the pulse read grant, writes do not", () => {
  it("a level-8 moo assigned to the other shop reads this shop's notes; a GM of the other shop does not", async () => {
    const { client } = fakeService({ "pulse_handoff_notes.select": [{ data: [], error: null }] });
    expect(await loadHandoffNotes(client, actor(8, "moo", [OTHER]), { locationId: SHOP, date: "2026-10-09" })).toEqual([]);
    await expect(loadHandoffNotes(client, actor(7, "gm", [OTHER]), { locationId: SHOP, date: "2026-10-09" })).rejects.toMatchObject({ code: "location_access_denied" });
  });
});
