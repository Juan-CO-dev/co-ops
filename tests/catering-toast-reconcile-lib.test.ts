/**
 * Item 21 PR 4: the house reconciler's caller (lib/catering/catering-toast-reconcile.ts) and the one note lookup
 * (lib/catering/toast-note-codes.ts). Everything is OFF by default; every RPC is its own request; a house failure is
 * counted, never thrown at the cron; ONE deadline owns each step (review PORTAL4-r1); and the lookup records what it
 * EXAMINED, so a lookup that failed leaves both sources waiting (the SQL refuses unexamined checks).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverHouseNoteEvidence, reconcileHouseCateringToast, runHouseCateringToast } from "@/lib/catering/catering-toast-reconcile";
import { coverUncoveredNotes, loadHouseNoteContext, lookupDayNoteCodes, NO_HOUSE_SIDE, type HouseNoteContext } from "@/lib/catering/toast-note-codes";
import { loadKnownToastOrderCodes, toastCodeSelectionKey } from "@/lib/ezcater/toast-codes";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/ezcater/toast-codes", async (original) => ({
  ...(await original<typeof import("@/lib/ezcater/toast-codes")>()), loadKnownToastOrderCodes: vi.fn(),
}));

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };
type Answer = Result | Promise<Result>;
/** A chainable PostgREST stand-in: every builder method returns the chain; awaiting it answers `tables[name]`. Every
 * chain records whether it was given an abort signal. */
function client(tables: Record<string, Answer | (() => Answer)>, rpcs: Record<string, (params: Record<string, unknown>) => Answer>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const unsignalled: string[] = [];
  const chain = (name: string, answer: () => Answer) => {
    let signalled = false;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "not", "gte", "lte", "order", "range"]) q[m] = () => q;
    q.abortSignal = (s: unknown) => { signalled = s instanceof AbortSignal; return q; };
    const settle = () => { if (!signalled) unsignalled.push(name); return Promise.resolve(answer()); };
    q.maybeSingle = () => settle();
    q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject);
    return q;
  };
  const sb = {
    from: (name: string) => chain(name, () => { const t = tables[name]; if (!t) throw new Error(`unexpected table ${name}`); return typeof t === "function" ? t() : t; }),
    rpc: (name: string, params: Record<string, unknown>) => { calls.push([name, params]); const f = rpcs[name]; if (!f) throw new Error(`unexpected rpc ${name}`); return chain(name, () => f(params)); },
  };
  return { sb: sb as never, calls, unsignalled };
}
const settings = (...rows: Array<Record<string, unknown>>) => ({ data: rows, error: null });
const shop = (id: string, s: Partial<{ codes: boolean; auto: boolean; origin: boolean }> = {}) =>
  ({ location_id: id, ring_code_enabled: s.codes ?? false, auto_link_enabled: s.auto ?? false, origin_auto_link_enabled: s.origin ?? false });
const WINDOW = () => ({ from: "2026-11-11", to: "2026-11-20", today: "2026-11-19", deadlineAt: Date.now() + 10_000 });
const EMPTY = { shops: 0, added: 0, ringCode: 0, toastOrigin: 0, evidencePending: 0, codes: 0, failed: 0 };

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); });

describe("reconcileHouseCateringToast", () => {
  it("no enabled shop, or an enabled shop with no switch = no RPC at all", async () => {
    for (const rows of [[], [shop("a")]]) {
      const { sb, calls } = client({ catering_toast_settings: settings(...rows) }, {});
      expect(await reconcileHouseCateringToast({ ...WINDOW(), client: sb })).toEqual(EMPTY);
      expect(calls).toEqual([]);
    }
  });

  it("0344 not applied (the settings table is missing) is not installed, never a failure", async () => {
    const { sb } = client({ catering_toast_settings: { error: { code: "42P01" } } }, {});
    expect(await reconcileHouseCateringToast({ ...WINDOW(), client: sb })).toMatchObject({ skipped: "not_installed", failed: 0 });
  });

  it("0348 not applied (the function is missing) is not installed", async () => {
    const { sb } = client({ catering_toast_settings: settings(shop("a", { auto: true })) },
      { reconcile_catering_toast: () => ({ error: { code: "PGRST202" } }) });
    expect(await reconcileHouseCateringToast({ ...WINDOW(), client: sb })).toMatchObject({ skipped: "not_installed", failed: 0, shops: 0 });
  });

  it("any other settings read failure throws; the cron seam turns it into null", async () => {
    const { sb } = client({ catering_toast_settings: { error: { code: "57014", message: "timeout" } } }, {});
    await expect(reconcileHouseCateringToast({ ...WINDOW(), client: sb })).rejects.toThrow("catering_toast_read_failed");
    expect(await runHouseCateringToast({ ...WINDOW(), client: sb })).toBeNull();
  });

  it("each switch calls only its own function, one request per shop, with the shop and the window; every request carries the deadline's signal", async () => {
    const { sb, calls, unsignalled } = client({ catering_toast_settings: settings(shop("a", { codes: true }), shop("b", { auto: true }), shop("c", { origin: true, codes: true })) }, {
      ensure_catering_ring_codes: (p) => ({ data: p.p_location_id === "a" ? 3 : 0, error: null }),
      reconcile_catering_toast: (p) => ({ data: p.p_location_id === "b" ? { added: 2, ring_code: 2, toast_origin: 0, skipped: { evidence_pending: 4, blocked: 1 } }
        : { added: 1, ring_code: 0, toast_origin: 1, skipped: {} }, error: null }),
    });
    expect(await reconcileHouseCateringToast({ ...WINDOW(), client: sb })).toEqual({ shops: 3, added: 3, ringCode: 2, toastOrigin: 1, evidencePending: 4, codes: 3, failed: 0 });
    expect(calls).toEqual([
      ["ensure_catering_ring_codes", { p_location_id: "a", p_from: "2026-11-19" }],
      ["reconcile_catering_toast", { p_location_id: "b", p_from: "2026-11-11", p_to: "2026-11-20" }],
      ["ensure_catering_ring_codes", { p_location_id: "c", p_from: "2026-11-19" }],
      ["reconcile_catering_toast", { p_location_id: "c", p_from: "2026-11-11", p_to: "2026-11-20" }],
    ]);
    expect(unsignalled).toEqual([]);
  });

  it("a shop that is off in SQL answers {skipped: off}: counted as a shop, nothing added", async () => {
    const { sb } = client({ catering_toast_settings: settings(shop("a", { auto: true })) }, { reconcile_catering_toast: () => ({ data: { skipped: "off" }, error: null }) });
    expect(await reconcileHouseCateringToast({ ...WINDOW(), client: sb })).toMatchObject({ shops: 1, added: 0, failed: 0, evidencePending: 0 });
  });

  it("one shop's failure is counted and the next shop still runs", async () => {
    const { sb, calls } = client({ catering_toast_settings: settings(shop("a", { auto: true }), shop("b", { auto: true })) }, {
      reconcile_catering_toast: (p) => p.p_location_id === "a" ? { error: { code: "57014", message: "statement timeout" } } : { data: { added: 1, ring_code: 1, toast_origin: 0 }, error: null },
    });
    expect(await reconcileHouseCateringToast({ ...WINDOW(), client: sb })).toMatchObject({ shops: 2, added: 1, failed: 1 });
    expect(calls).toHaveLength(2);
  });

  it("never calls an ezCater writer", async () => {
    const { sb, calls } = client({ catering_toast_settings: settings(shop("a", { codes: true, auto: true, origin: true })) }, {
      ensure_catering_ring_codes: () => ({ data: 0, error: null }), reconcile_catering_toast: () => ({ data: { added: 0 }, error: null }),
    });
    await reconcileHouseCateringToast({ ...WINDOW(), client: sb });
    expect(calls.map((c) => c[0]).filter((n) => /ezcater/.test(n))).toEqual([]);
  });

  it("review PORTAL4-r1 P2: a request that never answers cannot hold the cron past the step's deadline", async () => {
    vi.useFakeTimers();
    const stalled = new Promise<Result>(() => {});
    for (const tables of [{ catering_toast_settings: () => stalled }, { catering_toast_settings: settings(shop("a", { auto: true })) }]) {
      const { sb } = client(tables, { reconcile_catering_toast: () => stalled });
      const pending = runHouseCateringToast({ from: "2026-11-11", to: "2026-11-20", today: "2026-11-19", deadlineAt: Date.now() + 5_000, client: sb });
      let settled = false;
      void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(4_900);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(await pending).toBeNull();
    }
  });

  it("review PORTAL4-r1 P2: the note-lookup step is bounded the same way", async () => {
    vi.useFakeTimers();
    const { sb } = client({ catering_toast_settings: () => new Promise<Result>(() => {}) }, {});
    const pending = coverHouseNoteEvidence({ from: "2026-11-18", to: "2026-11-19", maxDays: 2, deadlineAt: Date.now() + 3_000, client: sb });
    await vi.advanceTimersByTimeAsync(3_100);
    expect(await pending).toBeNull();
  });
});

const captured = [{ orderGuid: "O1", snapshotId: "snap-1", modifiedAt: "2026-11-19T12:00:00Z" }, { orderGuid: "O2", snapshotId: "snap-2", modifiedAt: "2026-11-19T12:05:00Z" }];
const day = { locationId: "a", restaurantGuid: "rest", date: "2026-11-19", ezcaterCodes: ["ABC-123"], captured };
const house = (codes: string[] = ["COACD34"]): HouseNoteContext =>
  ({ shops: new Map([["a", { ringCodeEnabled: true, autoLink: true, originAutoLink: false }]]), ringCodes: new Map(codes.length ? [["a", codes]] : []) });
/** The lookup stand-in: answers `found` and reports `examined` the way the real one does. */
const toast = (found: Array<[string, string[]]>, examined: string[]) => vi.mocked(loadKnownToastOrderCodes).mockImplementation(async (_r, _d, _k, opts) => {
  for (const guid of examined) opts?.examined?.add(guid);
  return new Map(found);
});

describe("lookupDayNoteCodes: ONE lookup for both sources (contract #3)", () => {
  it("a shop with no house side: the old lookup, the same known codes, nothing recorded", async () => {
    toast([[toastCodeSelectionKey("O1", "C1", "S1"), ["ABC123"]]], ["O1", "O2"]);
    const { sb, calls } = client({}, {});
    const out = await lookupDayNoteCodes(sb, NO_HOUSE_SIDE, day);
    expect([...out]).toEqual([[toastCodeSelectionKey("O1", "C1", "S1"), ["ABC123"]]]);
    expect(vi.mocked(loadKnownToastOrderCodes).mock.calls[0]![2]).toEqual(["ABC123"]);
    expect(calls).toEqual([]);
  });

  it("an enabled shop: ring codes ride along; the EXAMINED captures and every intersection are recorded in one call (codes only), and ezCater gets only its own numbers", async () => {
    toast([[toastCodeSelectionKey("O1", "C1", "S1"), ["ABC123", "COACD34"]], [toastCodeSelectionKey("O1", "C2", "S2"), ["COACD34"]]], ["O1", "O2"]);
    const { sb, calls } = client({}, { record_catering_toast_note_lookup: () => ({ data: { examined: 2, codes: 3 }, error: null }) });
    const out = await lookupDayNoteCodes(sb, house(), day);
    expect(vi.mocked(loadKnownToastOrderCodes).mock.calls[0]![2]).toEqual(["ABC123", "COACD34"]);
    expect(vi.mocked(loadKnownToastOrderCodes).mock.calls[0]![3]?.expectedVersions).toEqual(new Map([["O1", "2026-11-19T12:00:00Z"], ["O2", "2026-11-19T12:05:00Z"]]));
    expect([...out]).toEqual([[toastCodeSelectionKey("O1", "C1", "S1"), ["ABC123"]]]);
    expect(calls).toEqual([["record_catering_toast_note_lookup", {
      p_examined: [{ location_id: "a", order_guid: "O1", toast_snapshot_id: "snap-1" }, { location_id: "a", order_guid: "O2", toast_snapshot_id: "snap-2" }],
      p_codes: [
        { location_id: "a", order_guid: "O1", check_guid: "C1", toast_snapshot_id: "snap-1", code: "ABC123" },
        { location_id: "a", order_guid: "O1", check_guid: "C1", toast_snapshot_id: "snap-1", code: "COACD34" },
        { location_id: "a", order_guid: "O1", check_guid: "C2", toast_snapshot_id: "snap-1", code: "COACD34" },
      ] }]]);
  });

  it("only a capture the lookup actually read is recorded as examined (a version that moved stays unexamined)", async () => {
    toast([], ["O2"]);
    const { sb, calls } = client({}, { record_catering_toast_note_lookup: () => ({ data: { examined: 1, codes: 0 }, error: null }) });
    await lookupDayNoteCodes(sb, house(), day);
    expect(calls).toEqual([["record_catering_toast_note_lookup", { p_examined: [{ location_id: "a", order_guid: "O2", toast_snapshot_id: "snap-2" }], p_codes: [] }]]);
  });

  it("nothing examined = nothing recorded, so the checks stay pending", async () => {
    toast([], []);
    const { sb, calls } = client({}, {});
    await lookupDayNoteCodes(sb, house(), day);
    expect(calls).toEqual([]);
  });

  it("an enabled shop with NO known code at all: nothing can intersect, so every capture is examined without calling Toast", async () => {
    const { sb, calls } = client({}, { record_catering_toast_note_lookup: () => ({ data: { examined: 2, codes: 0 }, error: null }) });
    expect((await lookupDayNoteCodes(sb, house([]), { ...day, ezcaterCodes: [] })).size).toBe(0);
    expect(loadKnownToastOrderCodes).not.toHaveBeenCalled();
    expect((calls[0]![1].p_examined as unknown[]).length).toBe(2);
  });

  it("a failed record throws, and the next call asks again (the publication that follows must not run without the house evidence)", async () => {
    toast([[toastCodeSelectionKey("O1", "C1", "S1"), ["COACD34"]]], ["O1"]);
    const { sb } = client({}, { record_catering_toast_note_lookup: () => ({ error: { code: "57014", message: "timeout" } }) });
    await expect(lookupDayNoteCodes(sb, house(), day)).rejects.toThrow("catering_toast_note_lookup_failed");
    await expect(lookupDayNoteCodes(sb, house(), day)).rejects.toThrow("catering_toast_note_lookup_failed");
    expect(loadKnownToastOrderCodes).toHaveBeenCalledTimes(2);
  });

  it("a failed Toast lookup throws before anything is recorded", async () => {
    vi.mocked(loadKnownToastOrderCodes).mockRejectedValue(new Error("ezcater_toast_bad_page"));
    const { sb, calls } = client({}, {});
    await expect(lookupDayNoteCodes(sb, house(), day)).rejects.toThrow("ezcater_toast_bad_page");
    expect(calls).toEqual([]);
  });

  it("0348 not applied: the ezCater side is unchanged (nothing to record, no throw)", async () => {
    toast([[toastCodeSelectionKey("O1", "C1", "S1"), ["ABC123"]]], ["O1"]);
    const { sb } = client({}, { record_catering_toast_note_lookup: () => ({ error: { code: "PGRST202" } }) });
    expect([...(await lookupDayNoteCodes(sb, house([]), day))]).toHaveLength(1);
  });

  it("review PORTAL4-r2: nothing is cached. An order Toast omitted the first time is asked for again and recorded the second time", async () => {
    const answers: string[][] = [["O1"], ["O1", "O2"]];
    vi.mocked(loadKnownToastOrderCodes).mockImplementation(async (_r, _d, _k, opts) => {
      for (const guid of answers.shift() ?? []) opts?.examined?.add(guid);
      return new Map();
    });
    const { sb, calls } = client({}, { record_catering_toast_note_lookup: () => ({ data: {}, error: null }) });
    await lookupDayNoteCodes(sb, house(), day);
    await lookupDayNoteCodes(sb, house(), day);
    expect(loadKnownToastOrderCodes).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => (c[1].p_examined as Array<{ order_guid: string }>).map((e) => e.order_guid))).toEqual([["O1"], ["O1", "O2"]]);
  });

  it("review PORTAL4-r2: the same holds when the first answer examined nothing at all", async () => {
    const answers: string[][] = [[], ["O1", "O2"]];
    vi.mocked(loadKnownToastOrderCodes).mockImplementation(async (_r, _d, _k, opts) => {
      for (const guid of answers.shift() ?? []) opts?.examined?.add(guid);
      return new Map();
    });
    const { sb, calls } = client({}, { record_catering_toast_note_lookup: () => ({ data: {}, error: null }) });
    await lookupDayNoteCodes(sb, house(), day);
    expect(calls).toEqual([]);
    await lookupDayNoteCodes(sb, house(), day);
    expect(loadKnownToastOrderCodes).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(1);
  });

  it("no captured catering order, or a shop that is off with no known code = no Toast call", async () => {
    const { sb } = client({}, {});
    await lookupDayNoteCodes(sb, NO_HOUSE_SIDE, { ...day, ezcaterCodes: [] });
    await lookupDayNoteCodes(sb, house(), { ...day, captured: [] });
    expect(loadKnownToastOrderCodes).not.toHaveBeenCalled();
  });
});

describe("loadHouseNoteContext", () => {
  it("not installed = no house side; no enabled shop = no ring-code read", async () => {
    expect(await loadHouseNoteContext(client({ catering_toast_settings: { error: { code: "PGRST205" } } }, {}).sb)).toBe(NO_HOUSE_SIDE);
    expect(await loadHouseNoteContext(client({ catering_toast_settings: settings() }, {}).sb)).toBe(NO_HOUSE_SIDE);
  });
  it("enabled shops with their switches and live ring codes; a failed read throws", async () => {
    const ctx = await loadHouseNoteContext(client({ catering_toast_settings: settings(shop("a", { auto: true }), shop("b")),
      catering_live_ring_codes: { data: [{ lead_id: "l1", location_id: "a", code_norm: "COACD34" }, { lead_id: "l2", location_id: "a", code_norm: "COACD36" }], error: null } }, {}).sb);
    expect([...ctx.shops.keys()]).toEqual(["a", "b"]);
    expect(ctx.shops.get("a")).toEqual({ ringCodeEnabled: false, autoLink: true, originAutoLink: false });
    expect(ctx.ringCodes.get("a")).toEqual(["COACD34", "COACD36"]);
    await expect(loadHouseNoteContext(client({ catering_toast_settings: { error: { code: "57014" } } }, {}).sb)).rejects.toThrow("catering_toast_read_failed");
    await expect(loadHouseNoteContext(client({ catering_toast_settings: settings(shop("a")), catering_live_ring_codes: { error: { code: "57014" } } }, {}).sb))
      .rejects.toThrow("catering_toast_read_failed");
  });
});

describe("coverUncoveredNotes: the captures nobody examined yet", () => {
  const tables = {
    catering_toast_settings: settings(shop("a", { auto: true })),
    catering_live_ring_codes: { data: [{ lead_id: "l1", location_id: "a", code_norm: "COACD34" }], error: null },
    locations: { data: { toast_restaurant_guid: "rest" }, error: null },
    ezcater_orders: { data: [{ id: "e1", order_number: "ABC-123" }], error: null },
  };
  const uncovered = (...rows: Array<[string, string]>) => () => ({ data: rows.map(([order_guid, business_date]) =>
    ({ order_guid, toast_snapshot_id: `snap-${order_guid}`, business_date, modified_at: "2026-11-19T12:00:00+00:00" })), error: null });
  const args = () => ({ from: "2026-11-18", to: "2026-11-19", maxDays: 2, deadlineAt: Date.now() + 10_000 });

  it("one lookup per day, newest first, with the union of codes; what it read is recorded as examined; every request carries the signal", async () => {
    toast([[toastCodeSelectionKey("O1", "C1", "S1"), ["COACD34"]]], ["O1", "O2", "O3"]);
    const { sb, calls, unsignalled } = client(tables, { catering_toast_uncovered_orders: uncovered(["O1", "2026-11-19"], ["O2", "2026-11-19"], ["O3", "2026-11-18"]),
      record_catering_toast_note_lookup: () => ({ data: {}, error: null }) });
    expect(await coverUncoveredNotes(sb, args())).toMatchObject({ lookups: 2, failed: 0 });
    expect(calls[0]).toEqual(["catering_toast_uncovered_orders", { p_location_id: "a", p_from: "2026-11-18", p_to: "2026-11-19" }]);
    expect(vi.mocked(loadKnownToastOrderCodes).mock.calls.map((c) => [c[1], c[2]])).toEqual([["2026-11-19", ["ABC123", "COACD34"]], ["2026-11-18", ["ABC123", "COACD34"]]]);
    expect(calls[1]![1]).toEqual({
      p_examined: [{ location_id: "a", order_guid: "O1", toast_snapshot_id: "snap-O1" }, { location_id: "a", order_guid: "O2", toast_snapshot_id: "snap-O2" }],
      p_codes: [{ location_id: "a", order_guid: "O1", check_guid: "C1", toast_snapshot_id: "snap-O1", code: "COACD34" }] });
    expect(unsignalled).toEqual([]);
  });

  it("item 21 PR 5: it reports how many captures it recorded as examined, and can be narrowed to one shop", async () => {
    toast([], ["O1", "O2", "O3"]);
    const { sb, calls } = client(tables, { catering_toast_uncovered_orders: uncovered(["O1", "2026-11-19"], ["O2", "2026-11-19"], ["O3", "2026-11-18"]),
      record_catering_toast_note_lookup: () => ({ data: {}, error: null }) });
    expect(await coverUncoveredNotes(sb, args())).toEqual({ lookups: 2, examined: 3, failed: 0 });
    calls.length = 0;
    expect(await coverUncoveredNotes(sb, { ...args(), onlyLocationId: "another-shop" })).toEqual({ lookups: 0, examined: 0, failed: 0 });
    expect(calls).toEqual([]);
    // Nothing read at the captured version = no progress, and it says so.
    toast([], []);
    expect(await coverUncoveredNotes(sb, { ...args(), onlyLocationId: "a" })).toEqual({ lookups: 2, examined: 0, failed: 0 });
  });

  it("at most maxDays days per shop and call (the rest waits for the next run)", async () => {
    toast([], []);
    const { sb } = client(tables, { catering_toast_uncovered_orders: uncovered(["O1", "2026-11-19"], ["O2", "2026-11-18"], ["O3", "2026-11-17"]) });
    expect(await coverUncoveredNotes(sb, { ...args(), maxDays: 2 })).toMatchObject({ lookups: 2, failed: 0 });
  });

  it("nothing uncovered = no shop read and no Toast call; a shop with no ring code and no automatic switch is not even asked", async () => {
    const quiet = client(tables, { catering_toast_uncovered_orders: uncovered() });
    expect(await coverUncoveredNotes(quiet.sb, args())).toMatchObject({ lookups: 0, failed: 0 });
    const idle = client({ catering_toast_settings: settings(shop("a")), catering_live_ring_codes: { data: [], error: null } }, {});
    expect(await coverUncoveredNotes(idle.sb, args())).toMatchObject({ lookups: 0, failed: 0 });
    expect(idle.calls).toEqual([]);
    expect(loadKnownToastOrderCodes).not.toHaveBeenCalled();
  });

  it("review PORTAL4-r1 P1: a failed record is counted and NOTHING is marked examined (the SQL then refuses those checks for both sources)", async () => {
    toast([[toastCodeSelectionKey("O1", "C1", "S1"), ["COACD34"]]], ["O1"]);
    const { sb, calls } = client(tables, { catering_toast_uncovered_orders: uncovered(["O1", "2026-11-19"]),
      record_catering_toast_note_lookup: () => ({ error: { code: "57014", message: "timeout" } }) });
    expect(await coverUncoveredNotes(sb, args())).toMatchObject({ lookups: 0, failed: 1 });
    // The one writer was asked once and refused: there is no second, partial write of coverage.
    expect(calls.filter((c) => c[0] === "record_catering_toast_note_lookup")).toHaveLength(1);
  });

  it("review PORTAL4-r2: a capture left unexamined by one run is looked up again by the next (the coverage is the only memory)", async () => {
    const answers: string[][] = [[], ["O1"]];
    vi.mocked(loadKnownToastOrderCodes).mockImplementation(async (_r, _d, _k, opts) => {
      for (const guid of answers.shift() ?? []) opts?.examined?.add(guid);
      return new Map();
    });
    // The database keeps listing O1 until a lookup records it.
    const { sb, calls } = client(tables, { catering_toast_uncovered_orders: uncovered(["O1", "2026-11-19"]), record_catering_toast_note_lookup: () => ({ data: {}, error: null }) });
    expect(await coverUncoveredNotes(sb, args())).toMatchObject({ lookups: 1, failed: 0 });
    expect(calls.filter((c) => c[0] === "record_catering_toast_note_lookup")).toHaveLength(0);
    expect(await coverUncoveredNotes(sb, args())).toMatchObject({ lookups: 1, failed: 0 });
    expect(loadKnownToastOrderCodes).toHaveBeenCalledTimes(2);
    expect(calls.filter((c) => c[0] === "record_catering_toast_note_lookup").map((c) => c[1].p_examined)).toEqual([[{ location_id: "a", order_guid: "O1", toast_snapshot_id: "snap-O1" }]]);
  });

  it("a failed Toast lookup or a failed read is counted, never thrown; 0348 missing is not installed", async () => {
    vi.mocked(loadKnownToastOrderCodes).mockRejectedValue(new Error("capture_deadline"));
    expect(await coverUncoveredNotes(client(tables, { catering_toast_uncovered_orders: uncovered(["O1", "2026-11-19"]) }).sb, args())).toMatchObject({ lookups: 0, failed: 1 });
    expect(await coverUncoveredNotes(client(tables, { catering_toast_uncovered_orders: () => ({ error: { code: "57014" } }) }).sb, args())).toMatchObject({ lookups: 0, failed: 1 });
    expect(await coverUncoveredNotes(client(tables, { catering_toast_uncovered_orders: () => ({ error: { code: "PGRST202" } }) }).sb, args()))
      .toEqual({ lookups: 0, examined: 0, failed: 0, skipped: "not_installed" });
  });
});
