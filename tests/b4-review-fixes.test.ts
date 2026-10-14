/**
 * B4 review fixes - behaviour tests (not source pins):
 *  1. #16  mid-day reconcile carries the report's TRUE submission time, not "now".
 *  2. #20  START BREAK stays hidden after End my shift even while Toast still says clocked in.
 *  3. #19  a closed station is not shown once the holder ended their shift after the close.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadShiftBoard } from "@/lib/assignments";
import { closedStationFor, showBreakButton, type ShiftBoard } from "@/lib/assignments-shared";
import { coopsShiftEnded, personPresence } from "@/lib/presence-shared";
import { midDayTickIsStale, pickMidDayReport, reconcileClosingReportRefs } from "@/lib/prep";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/assignment-taken", () => ({ loadTakenTasks: vi.fn(async () => []) }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

// -- 1. mid-day reconcile -----------------------------------------------------------------------
type MdRow = { id: string; triggered_at: string; confirmed_at: string | null };
type Head = { id: string; revoked_at: string | null; auto_complete_meta: Record<string, unknown> } | null;
/** Minimal chainable Supabase fake: answers by table + eq filters, records inserts and supersedes. */
function reconcileService(midDayRows: MdRow[], head: Head = null) {
  const inserts: Array<Record<string, unknown>> = [];
  const supersedes: Array<Record<string, unknown>> = [];
  const from = (table: string) => {
    const eq = new Map<string, unknown>();
    let op: "select" | "insert" | "update" = "select";
    const single = (): unknown => {
      if (table === "checklist_templates") {
        if (eq.get("type") === "closing") return { id: "closing-tmpl" };
        if (eq.get("prep_subtype") === "mid_day_prep") return { id: "mid-tmpl", name: "Mid-day" };
        return null;
      }
      if (table === "checklist_template_items") return eq.get("report_reference_type") === "mid_day_prep" ? { id: "mid-ref-item" } : null;
      if (op === "insert") return { id: "new-completion" };
      return head; // the live closing completion, if any
    };
    const q: Record<string, unknown> = {
      select: () => q, returns: () => q, order: () => q, limit: () => q, is: () => q, in: () => q, lte: () => q, gte: () => q, or: () => q, not: () => q,
      eq: (k: string, v: unknown) => { eq.set(k, v); return q; },
      insert: (row: Record<string, unknown>) => { op = "insert"; inserts.push(row); return q; },
      update: (row: Record<string, unknown>) => { op = "update"; supersedes.push(row); return q; },
      maybeSingle: async () => ({ data: single(), error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({
        data: table === "checklist_instances" ? midDayRows : [], error: null, count: op === "update" ? 1 : 0,
      }).then(resolve),
    };
    return q;
  };
  return { service: { from } as unknown as SupabaseClient, inserts, supersedes };
}
const reconcile = (service: SupabaseClient) => reconcileClosingReportRefs(service, {
  locationId: "loc", date: "2026-10-11", closingInstanceId: "closing-1", actor: { userId: "u1" } as never,
});
type Meta = { reportType: string; reportSubmittedAt?: string; count: number; reportInstanceId: string };
const metaOf = (row: Record<string, unknown> | undefined) => row?.auto_complete_meta as Meta;
const eveningOpen = () => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T00:00:00Z")); }; // 8 PM ET

describe("#16 reconcile carries the real mid-day submission time", () => {
  it("uses the confirmed_at of the report, not the moment the closing page was opened", async () => {
    eveningOpen();
    const { service, inserts } = reconcileService([
      { id: "md-1", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T18:10:00Z" },
      { id: "md-2", triggered_at: "2026-10-11T18:30:00Z", confirmed_at: "2026-10-11T19:00:00Z" },
    ]);
    expect((await reconcile(service)).ticked).toBe(1);
    expect(inserts[0]).toMatchObject({ instance_id: "closing-1", template_item_id: "mid-ref-item" });
    expect(metaOf(inserts[0])).toMatchObject({ reportType: "mid_day_prep", count: 2, reportInstanceId: "md-2", reportSubmittedAt: "2026-10-11T19:00:00Z" });
  });

  it("out of order: A started first but confirmed last (4 PM) beats B started second, confirmed 3 PM - id and time from the SAME row", async () => {
    eveningOpen();
    const rows: MdRow[] = [
      { id: "A", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T20:00:00Z" }, // 4 PM ET
      { id: "B", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }, // 3 PM ET
    ];
    const { service, inserts } = reconcileService(rows);
    await reconcile(service);
    expect(metaOf(inserts[0]).reportInstanceId).toBe("A");
    expect(metaOf(inserts[0]).reportSubmittedAt).toBe("2026-10-11T20:00:00Z");
    expect(pickMidDayReport(rows)).toEqual({ reportInstanceId: "A", reportSubmittedAt: "2026-10-11T20:00:00Z" });
  });

  it("never invents 'now' when no row has confirmed_at: uses the row's own start time, or omits the time", async () => {
    eveningOpen();
    const started = reconcileService([{ id: "md-1", triggered_at: "2026-10-11T19:00:00Z", confirmed_at: null }]);
    await reconcile(started.service);
    expect(metaOf(started.inserts[0]).reportSubmittedAt).toBe("2026-10-11T19:00:00Z");

    const unknown = reconcileService([{ id: "md-1", triggered_at: null as unknown as string, confirmed_at: null }]);
    await reconcile(unknown.service);
    const meta = metaOf(unknown.inserts[0]);
    expect(meta.reportInstanceId).toBe("md-1");
    expect("reportSubmittedAt" in meta).toBe(false); // display falls back to the tick's own time
    expect(JSON.stringify(meta)).not.toContain("2026-10-12T00:00:00");
  });

  it("repairs an existing tick written by old code (same count, closing-open time), then stays idempotent", async () => {
    eveningOpen();
    const rows: MdRow[] = [{ id: "md-1", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }];
    const oldHead: Head = { id: "head-1", revoked_at: null, auto_complete_meta: {
      reportType: "mid_day_prep", reportInstanceId: "md-1", reportSubmittedAt: "2026-10-11T23:59:00.000Z", count: 1,
    } };
    const stale = reconcileService(rows, oldHead);
    expect((await reconcile(stale.service)).ticked).toBe(1);
    expect(stale.inserts).toHaveLength(1);
    expect(stale.supersedes).toHaveLength(1);
    expect(metaOf(stale.inserts[0]).reportSubmittedAt).toBe("2026-10-11T19:00:00Z");

    // Stored time equal as an INSTANT (different spelling) -> no churn.
    const fresh = reconcileService(rows, { ...oldHead!, auto_complete_meta: { ...oldHead!.auto_complete_meta, reportSubmittedAt: "2026-10-11T19:00:00.000+00:00" } });
    expect((await reconcile(fresh.service)).ticked).toBe(0);
    expect(fresh.inserts).toHaveLength(0);
    expect(fresh.supersedes).toHaveLength(0);
  });

  it("a head with no stored time is repaired; a wrong stored instance is repaired; an unknown true time never churns", () => {
    expect(midDayTickIsStale({ reportInstanceId: "A" }, { reportInstanceId: "A", reportSubmittedAt: "2026-10-11T19:00:00Z" })).toBe(true);
    expect(midDayTickIsStale({ reportInstanceId: "B", reportSubmittedAt: "2026-10-11T19:00:00Z" }, { reportInstanceId: "A", reportSubmittedAt: "2026-10-11T19:00:00Z" })).toBe(true);
    expect(midDayTickIsStale({ reportInstanceId: "A", reportSubmittedAt: "2026-10-11T23:00:00Z" }, { reportInstanceId: "A", reportSubmittedAt: null })).toBe(false);
    expect(midDayTickIsStale({ reportInstanceId: "A" }, undefined)).toBe(false);
  });
});

// -- 2. START BREAK vs Toast --------------------------------------------------------------------
describe("#20 START BREAK after End my shift while Toast says clocked in", () => {
  const toastOpen = { entries: [{ inAt: "2026-10-12T13:58:00Z", outAt: null }] };
  const coops = (over: Partial<Parameters<typeof personPresence>[1]> = {}) => ({
    stationAt: null, taskAt: null, signedInAt: "2026-10-12T14:00:00Z", endedAt: "2026-10-12T20:00:00Z", shopClosedAt: null, ...over,
  });
  it("Toast outranks CO-OPS in presence, so presence alone says still on shift", () => {
    expect(personPresence(toastOpen, coops()).onShift).toBe(true);
  });
  it("coopsShiftEnded is true after the end, false again once newer activity exists", () => {
    expect(coopsShiftEnded(coops())).toBe(true);
    expect(coopsShiftEnded(coops({ endedAt: null }))).toBe(false);
    expect(coopsShiftEnded(coops({ stationAt: "2026-10-12T20:05:00Z" }))).toBe(false);
    expect(coopsShiftEnded(coops({ taskAt: "2026-10-12T20:05:00Z" }))).toBe(false);
    expect(coopsShiftEnded(coops({ stationAt: "2026-10-12T19:00:00Z" }))).toBe(true);
  });
  it("the combined state (Toast clocked in + ended shift) hides the button", () => {
    const facts = coops();
    const person = { presence: personPresence(toastOpen, facts), shiftEnded: coopsShiftEnded(facts) };
    expect(person.presence.onShift).toBe(true);
    expect(showBreakButton(person, { whosHere: true })).toBe(false);
  });
  it("still offers the break while on shift, and CLAIM-after-end brings it back", () => {
    const facts = coops({ endedAt: null });
    expect(showBreakButton({ presence: personPresence(toastOpen, facts), shiftEnded: coopsShiftEnded(facts) }, { whosHere: true })).toBe(true);
    const reclaimed = coops({ stationAt: "2026-10-12T20:30:00Z" });
    expect(showBreakButton({ presence: personPresence(toastOpen, reclaimed), shiftEnded: coopsShiftEnded(reclaimed) }, { whosHere: true })).toBe(true);
  });
});

// -- 2 + 3 through the real loader --------------------------------------------------------------
const shop = "11111111-1111-4111-8111-111111111111";
const gm = "22222222-2222-4222-8222-222222222222";
const cook = "33333333-3333-4333-8333-333333333333"; // Toast-clocked, holds Slicer
const slicerRelease = {
  id: "e2", sequence: "2", location_id: shop, business_date: "2026-10-12", user_id: cook, station_id: null, position_id: null,
  prior_position_id: "position", kind: "release", actor_id: null, at: "2026-10-12T16:05:00Z", effective_at: "2026-10-12T16:00:00Z",
  source: null, reason_code: "station_closed",
};
function loaderClient(shiftEnds: unknown[]) {
  const rows: Record<string, unknown[]> = {
    users: [{ id: gm, name: "Gina", role: "gm", active: true }, { id: cook, name: "Carl", role: "employee", active: true }],
    user_locations: [{ user_id: gm }, { user_id: cook }],
    stations: [{ id: "slicer", name: "Slicer", name_es: null, sort: 1, active: true, staffed: true, usually_closes_at: null }],
    station_positions: [{ id: "position", station_id: "slicer", name: "Lead", name_es: null, duty: null, duty_es: null, sort: 1, active: true, usually_trims_at: null }],
    station_events: [
      { id: "e1", sequence: "1", location_id: shop, business_date: "2026-10-12", user_id: cook, station_id: "slicer", position_id: "position",
        kind: "assign", actor_id: gm, at: "2026-10-12T14:00:00Z", source: "assigned" },
      slicerRelease,
    ],
    toast_time_entries: [{ user_id: cook, in_at: "2026-10-12T13:58:00Z", out_at: null }],
    shift_ends: shiftEnds,
    sessions: [],
  };
  const rpc = vi.fn(async (name: string) => ({
    data: name === "station_business_date" ? "2026-10-12" : name === "station_closures" ? [{ station_id: "slicer", closed_at: "2026-10-12T16:00:00Z" }] : [],
    error: null,
  }));
  const from = (table: string) => {
    const result = () => ({ data: rows[table] ?? [], error: null });
    const q = {
      select: () => q, order: () => q, not: () => q, gte: () => q, in: () => q, eq: () => q,
      range: async () => result(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return q;
  };
  return { from, rpc } as unknown as SupabaseClient;
}
async function board(shiftEnds: unknown[]): Promise<ShiftBoard> {
  vi.stubEnv("WHOS_HERE", "1");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T18:00:00Z"));
  return loadShiftBoard(loaderClient(shiftEnds), { actor: { userId: gm, role: "gm", level: 7, locations: [shop] }, locationId: shop, date: "2026-10-12" });
}
const endedAfterClose = [{ user_id: cook, kind: "ended_shift", at: "2026-10-12T17:00:00Z" }];
const endedBeforeClose = [{ user_id: cook, kind: "ended_shift", at: "2026-10-12T15:00:00Z" }];

describe("the loader feeds both fixes", () => {
  it("#20: Toast-clocked cook who ended shift is onShift in presence but shiftEnded, so no break button", async () => {
    const b = await board(endedAfterClose);
    const cookRow = b.people.find((p) => p.id === cook)!;
    expect(cookRow.presence?.onShift).toBe(true);
    expect(cookRow.shiftEnded).toBe(true);
    expect(cookRow.shiftEndedAt).toBe("2026-10-12T17:00:00Z");
    expect(showBreakButton(cookRow, b)).toBe(false);
  });
  it("#19: the closed station shows after the close, and stops showing once the holder ended their shift", async () => {
    const stillHere = await board([]);
    expect(closedStationFor(stillHere, cook)?.station.id).toBe("slicer");
    expect(showBreakButton(stillHere.people.find((p) => p.id === cook)!, stillHere)).toBe(true);

    const ended = await board(endedAfterClose);
    expect(closedStationFor(ended, cook)).toBeNull();
  });
  it("#19: an end BEFORE the close (older shift) does not hide the closed station", async () => {
    const b = await board(endedBeforeClose);
    expect(closedStationFor(b, cook)?.station.id).toBe("slicer");
  });
});
