/**
 * Item 21 PR 4: the house reconciler's caller (lib/catering/catering-toast-reconcile.ts) and the one note lookup
 * (lib/catering/toast-note-codes.ts). Everything is OFF by default; every RPC is its own request; a house failure is
 * counted, never thrown at the cron.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileHouseCateringToast, runHouseCateringToast } from "@/lib/catering/catering-toast-reconcile";
import { loadHouseNoteContext, lookupDayNoteCodes, lookupHouseNoteCodes, resetNoteLookupMemo, NO_HOUSE_SIDE } from "@/lib/catering/toast-note-codes";
import { loadKnownToastOrderCodes, toastCodeSelectionKey } from "@/lib/ezcater/toast-codes";
import { loadCapturedToastDay } from "@/lib/toast/captured-day";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/ezcater/toast-codes", async (original) => ({
  ...(await original<typeof import("@/lib/ezcater/toast-codes")>()), loadKnownToastOrderCodes: vi.fn(),
}));
vi.mock("@/lib/toast/captured-day", () => ({ loadCapturedToastDay: vi.fn() }));

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };
/** A chainable PostgREST stand-in: every builder method returns the chain; awaiting it answers `tables[name]`. */
function client(tables: Record<string, Result | (() => Result)>, rpcs: Record<string, (params: Record<string, unknown>) => Result>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const chain = (answer: () => Result) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "not", "gte", "lte", "order", "range", "abortSignal"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve(answer());
    q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject);
    return q;
  };
  const sb = {
    from: (name: string) => chain(() => { const t = tables[name]; if (!t) throw new Error(`unexpected table ${name}`); return typeof t === "function" ? t() : t; }),
    rpc: (name: string, params: Record<string, unknown>) => { calls.push([name, params]); const f = rpcs[name]; if (!f) throw new Error(`unexpected rpc ${name}`); return chain(() => f(params)); },
  };
  return { sb: sb as never, calls };
}
const settings = (...rows: Array<Record<string, unknown>>) => ({ data: rows, error: null });
const shop = (id: string, s: Partial<{ codes: boolean; auto: boolean; origin: boolean }>) =>
  ({ location_id: id, ring_code_enabled: s.codes ?? false, auto_link_enabled: s.auto ?? false, origin_auto_link_enabled: s.origin ?? false });
const WINDOW = { from: "2026-11-11", to: "2026-11-20", today: "2026-11-19" };

beforeEach(() => { vi.clearAllMocks(); resetNoteLookupMemo(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("reconcileHouseCateringToast", () => {
  it("no enabled shop, or an enabled shop with no switch = no RPC at all", async () => {
    for (const rows of [[], [shop("a", {})]]) {
      const { sb, calls } = client({ catering_toast_settings: settings(...rows) }, {});
      expect(await reconcileHouseCateringToast({ ...WINDOW, client: sb })).toEqual({ shops: 0, added: 0, ringCode: 0, toastOrigin: 0, codes: 0, failed: 0 });
      expect(calls).toEqual([]);
    }
  });

  it("0344 not applied (the settings table is missing) is not installed, never a failure", async () => {
    const { sb } = client({ catering_toast_settings: { error: { code: "42P01" } } }, {});
    expect(await reconcileHouseCateringToast({ ...WINDOW, client: sb })).toMatchObject({ skipped: "not_installed", failed: 0 });
  });

  it("0348 not applied (the function is missing) is not installed", async () => {
    const { sb } = client({ catering_toast_settings: settings(shop("a", { auto: true })) },
      { reconcile_catering_toast: () => ({ error: { code: "PGRST202" } }) });
    expect(await reconcileHouseCateringToast({ ...WINDOW, client: sb })).toMatchObject({ skipped: "not_installed", failed: 0, shops: 0 });
  });

  it("any other settings read failure throws; the cron seam turns it into null", async () => {
    const { sb } = client({ catering_toast_settings: { error: { code: "57014", message: "timeout" } } }, {});
    await expect(reconcileHouseCateringToast({ ...WINDOW, client: sb })).rejects.toThrow("catering_toast_read_failed");
    expect(await runHouseCateringToast({ ...WINDOW, client: sb })).toBeNull();
  });

  it("each switch calls only its own function, one request per shop, with the shop and the window", async () => {
    const { sb, calls } = client({ catering_toast_settings: settings(shop("a", { codes: true }), shop("b", { auto: true }), shop("c", { origin: true, codes: true })) }, {
      ensure_catering_ring_codes: (p) => ({ data: p.p_location_id === "a" ? 3 : 0, error: null }),
      reconcile_catering_toast: (p) => ({ data: p.p_location_id === "b" ? { added: 2, ring_code: 2, toast_origin: 0 } : { added: 1, ring_code: 0, toast_origin: 1 }, error: null }),
    });
    expect(await reconcileHouseCateringToast({ ...WINDOW, client: sb })).toEqual({ shops: 3, added: 3, ringCode: 2, toastOrigin: 1, codes: 3, failed: 0 });
    expect(calls).toEqual([
      ["ensure_catering_ring_codes", { p_location_id: "a", p_from: "2026-11-19" }],
      ["reconcile_catering_toast", { p_location_id: "b", p_from: "2026-11-11", p_to: "2026-11-20" }],
      ["ensure_catering_ring_codes", { p_location_id: "c", p_from: "2026-11-19" }],
      ["reconcile_catering_toast", { p_location_id: "c", p_from: "2026-11-11", p_to: "2026-11-20" }],
    ]);
  });

  it("a shop that is off in SQL answers {skipped: off}: counted as a shop, nothing added", async () => {
    const { sb } = client({ catering_toast_settings: settings(shop("a", { auto: true })) }, { reconcile_catering_toast: () => ({ data: { skipped: "off" }, error: null }) });
    expect(await reconcileHouseCateringToast({ ...WINDOW, client: sb })).toMatchObject({ shops: 1, added: 0, failed: 0 });
  });

  it("one shop's failure is counted and the next shop still runs", async () => {
    const { sb, calls } = client({ catering_toast_settings: settings(shop("a", { auto: true }), shop("b", { auto: true })) }, {
      reconcile_catering_toast: (p) => p.p_location_id === "a" ? { error: { code: "57014", message: "statement timeout" } } : { data: { added: 1, ring_code: 1, toast_origin: 0 }, error: null },
    });
    expect(await reconcileHouseCateringToast({ ...WINDOW, client: sb })).toMatchObject({ shops: 2, added: 1, failed: 1 });
    expect(calls).toHaveLength(2);
  });

  it("never calls an ezCater writer", async () => {
    const { sb, calls } = client({ catering_toast_settings: settings(shop("a", { codes: true, auto: true, origin: true })) }, {
      ensure_catering_ring_codes: () => ({ data: 0, error: null }), reconcile_catering_toast: () => ({ data: { added: 0 }, error: null }),
    });
    await reconcileHouseCateringToast({ ...WINDOW, client: sb });
    expect(calls.map((c) => c[0]).filter((n) => /ezcater/.test(n))).toEqual([]);
  });
});

const captured = [{ orderGuid: "O1", snapshotId: "snap-1", modifiedAt: "2026-11-19T12:00:00Z" }];
const day = { locationId: "a", restaurantGuid: "rest", date: "2026-11-19", ezcaterCodes: ["ABC-123"], captured };
const house = { enabled: new Set(["a"]), ringCodes: new Map([["a", ["COACD34"]]]) };

describe("lookupDayNoteCodes: ONE lookup for both sources (contract #3)", () => {
  it("a shop with no house side: the old lookup, the same known codes, nothing recorded", async () => {
    vi.mocked(loadKnownToastOrderCodes).mockResolvedValue(new Map([[toastCodeSelectionKey("O1", "C1", "S1"), ["ABC123"]]]));
    const { sb, calls } = client({}, {});
    const out = await lookupDayNoteCodes(sb, NO_HOUSE_SIDE, day);
    expect([...out]).toEqual([[toastCodeSelectionKey("O1", "C1", "S1"), ["ABC123"]]]);
    expect(vi.mocked(loadKnownToastOrderCodes).mock.calls[0]![2]).toEqual(["ABC123"]);
    expect(calls).toEqual([]);
  });

  it("an enabled shop: ring codes ride along, every intersection is recorded (codes only, fenced to the capture), and ezCater gets only its own numbers", async () => {
    vi.mocked(loadKnownToastOrderCodes).mockResolvedValue(new Map([
      [toastCodeSelectionKey("O1", "C1", "S1"), ["ABC123", "COACD34"]], [toastCodeSelectionKey("O1", "C2", "S2"), ["COACD34"]]]));
    const { sb, calls } = client({}, { record_catering_toast_note_codes: () => ({ data: 3, error: null }) });
    const out = await lookupDayNoteCodes(sb, house, day);
    expect(vi.mocked(loadKnownToastOrderCodes).mock.calls[0]![2]).toEqual(["ABC123", "COACD34"]);
    expect(vi.mocked(loadKnownToastOrderCodes).mock.calls[0]![3]?.expectedVersions).toEqual(new Map([["O1", "2026-11-19T12:00:00Z"]]));
    expect([...out]).toEqual([[toastCodeSelectionKey("O1", "C1", "S1"), ["ABC123"]]]);
    expect(calls).toEqual([["record_catering_toast_note_codes", { p_rows: [
      { location_id: "a", order_guid: "O1", check_guid: "C1", toast_snapshot_id: "snap-1", code: "ABC123" },
      { location_id: "a", order_guid: "O1", check_guid: "C1", toast_snapshot_id: "snap-1", code: "COACD34" },
      { location_id: "a", order_guid: "O1", check_guid: "C2", toast_snapshot_id: "snap-1", code: "COACD34" },
    ] }]]);
  });

  it("a failed record throws (the publication that follows must not run without the house evidence)", async () => {
    vi.mocked(loadKnownToastOrderCodes).mockResolvedValue(new Map([[toastCodeSelectionKey("O1", "C1", "S1"), ["COACD34"]]]));
    const { sb } = client({}, { record_catering_toast_note_codes: () => ({ error: { code: "57014", message: "timeout" } }) });
    await expect(lookupDayNoteCodes(sb, house, day)).rejects.toThrow("catering_toast_note_codes_failed");
  });

  it("0348 not applied: the ezCater side is unchanged (nothing to record, no throw)", async () => {
    vi.mocked(loadKnownToastOrderCodes).mockResolvedValue(new Map([[toastCodeSelectionKey("O1", "C1", "S1"), ["ABC123"]]]));
    const { sb } = client({}, { record_catering_toast_note_codes: () => ({ error: { code: "PGRST202" } }) });
    expect([...(await lookupDayNoteCodes(sb, { enabled: new Set(["a"]), ringCodes: new Map() }, day))]).toHaveLength(1);
  });

  it("the same shop, day, codes and versions are looked up once per process; a new version looks again", async () => {
    vi.mocked(loadKnownToastOrderCodes).mockResolvedValue(new Map());
    const { sb } = client({}, {});
    await lookupDayNoteCodes(sb, house, day);
    await lookupDayNoteCodes(sb, house, day);
    expect(loadKnownToastOrderCodes).toHaveBeenCalledTimes(1);
    await lookupDayNoteCodes(sb, house, { ...day, captured: [{ ...captured[0]!, modifiedAt: "2026-11-19T13:00:00Z", snapshotId: "snap-2" }] });
    expect(loadKnownToastOrderCodes).toHaveBeenCalledTimes(2);
  });

  it("no known code or no captured catering order = no Toast call", async () => {
    const { sb } = client({}, {});
    await lookupDayNoteCodes(sb, NO_HOUSE_SIDE, { ...day, ezcaterCodes: [] });
    await lookupDayNoteCodes(sb, house, { ...day, captured: [] });
    expect(loadKnownToastOrderCodes).not.toHaveBeenCalled();
  });
});

describe("loadHouseNoteContext", () => {
  it("not installed = no house side; no enabled shop = no ring-code read", async () => {
    expect(await loadHouseNoteContext(client({ catering_toast_settings: { error: { code: "PGRST205" } } }, {}).sb)).toBe(NO_HOUSE_SIDE);
    expect(await loadHouseNoteContext(client({ catering_toast_settings: settings() }, {}).sb)).toBe(NO_HOUSE_SIDE);
  });
  it("enabled shops with their live ring codes; a failed read throws", async () => {
    const ctx = await loadHouseNoteContext(client({ catering_toast_settings: settings({ location_id: "a" }, { location_id: "b" }),
      catering_live_ring_codes: { data: [{ lead_id: "l1", location_id: "a", code_norm: "COACD34" }, { lead_id: "l2", location_id: "a", code_norm: "COACD36" }], error: null } }, {}).sb);
    expect([...ctx.enabled]).toEqual(["a", "b"]);
    expect(ctx.ringCodes.get("a")).toEqual(["COACD34", "COACD36"]);
    await expect(loadHouseNoteContext(client({ catering_toast_settings: { error: { code: "57014" } } }, {}).sb)).rejects.toThrow("catering_toast_read_failed");
    await expect(loadHouseNoteContext(client({ catering_toast_settings: settings({ location_id: "a" }), catering_live_ring_codes: { error: { code: "57014" } } }, {}).sb))
      .rejects.toThrow("catering_toast_read_failed");
  });
});

describe("lookupHouseNoteCodes: the house-only days", () => {
  const tables = {
    catering_toast_settings: settings({ location_id: "a" }),
    catering_live_ring_codes: { data: [{ lead_id: "l1", location_id: "a", code_norm: "COACD34" }], error: null },
    catering_reconciliation_status: { data: [{ lead_id: "l1", event_date: "2026-11-18" }], error: null },
    locations: { data: { toast_restaurant_guid: "rest" }, error: null },
    ezcater_orders: { data: [{ id: "e1", order_number: "ABC-123" }], error: null },
  };
  const live = (orderGuid: string) => ({ orderGuid, snapshotId: `snap-${orderGuid}`, modifiedAt: "2026-11-19T12:00:00Z", salesChannel: "catering",
    voided: false, deleted: false, excessFood: false, diningOptionGuid: null, diningOption: null, selections: [], checks: [] });

  it("looks up each day an unlinked ring-code lead could be rung on, never after today, with the union of codes", async () => {
    vi.mocked(loadCapturedToastDay).mockImplementation(async (_loc, date) => date === "2026-11-18" ? { coverage: {} as never, orders: [live("O1")] } : null);
    vi.mocked(loadKnownToastOrderCodes).mockResolvedValue(new Map([[toastCodeSelectionKey("O1", "C1", "S1"), ["COACD34"]]]));
    const { sb, calls } = client(tables, { record_catering_toast_note_codes: () => ({ data: 1, error: null }) });
    expect(await lookupHouseNoteCodes(sb, { ...WINDOW, deadlineAt: Date.now() + 10_000 })).toEqual({ lookups: 1, failed: 0 });
    // event 11-18: days 11-17, 11-18, 11-19 (today); nothing later.
    expect(vi.mocked(loadCapturedToastDay).mock.calls.map((c) => c[1])).toEqual(["2026-11-19", "2026-11-18", "2026-11-17"]);
    expect(vi.mocked(loadKnownToastOrderCodes).mock.calls[0]![2]).toEqual(["ABC123", "COACD34"]);
    expect(calls[0]![1]).toEqual({ p_rows: [{ location_id: "a", order_guid: "O1", check_guid: "C1", toast_snapshot_id: "snap-O1", code: "COACD34" }] });
  });

  it("a shop with no live ring code makes no read and no Toast call", async () => {
    const { sb } = client({ catering_toast_settings: tables.catering_toast_settings, catering_live_ring_codes: { data: [], error: null } }, {});
    expect(await lookupHouseNoteCodes(sb, { ...WINDOW, deadlineAt: Date.now() + 10_000 })).toEqual({ lookups: 0, failed: 0 });
    expect(loadCapturedToastDay).not.toHaveBeenCalled();
  });

  it("a failed shop is counted, never thrown", async () => {
    const { sb } = client({ ...tables, catering_reconciliation_status: { error: { code: "57014" } } }, {});
    expect(await lookupHouseNoteCodes(sb, { ...WINDOW, deadlineAt: Date.now() + 10_000 })).toEqual({ lookups: 0, failed: 1 });
  });
});
