/**
 * Nav PR 8 (plan r2 2.16, A6; lead rulings r2 B1): the not-rung readers WITH whether a shop's house orders are checked.
 * - `readHouseNotInToastWithState`: no enabled settings row → `off`; 0344 missing → `not_installed`; else `on` + rows.
 * - `readNotInToastScoped`: one shop's ezCater rows + its house rows, with the house state.
 * - The reconciliation lists only `not_rung_in_toast`: a house order it treats as `no_ring_expected` (0344:247, no Toast
 *   link) is not a row, so an empty list never proves every order is in Toast (the render's wording: B1).
 * - `readHouseNotInToast` (the loop over the per-shop read) answers byte for byte as before; its own tests
 *   (tests/catering-toast-house-reader.test.ts) run unchanged.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
import { readHouseNotInToast, readHouseNotInToastWithState } from "@/lib/catering/catering-toast";
import { readNotInToast, readNotInToastScoped } from "@/lib/catering/not-in-toast";
import { withAbortStrict } from "@/lib/pulse/abort";
import { ezRow, houseRow, notInToastClient, toastSettings, type NotInToastTables } from "./helpers/not-in-toast-fake";

const THROUGH = { through: "2026-11-20" };
const base = (over: NotInToastTables = {}): NotInToastTables => ({
  ezcater_reconciliation_status: [ezRow()], catering_toast_settings: [toastSettings()], catering_reconciliation_status: [houseRow()], ...over });

describe("readHouseNotInToastWithState", () => {
  it("on: the shop's listed house rows", async () => {
    const r = await readHouseNotInToastWithState(notInToastClient(base()).client, "shop", THROUGH);
    expect(r.house).toBe("on");
    expect(r.rows.map((x) => x.order_id)).toEqual(["h1"]);
  });
  it("off: no settings row, or not enabled; the house view is not read", async () => {
    for (const settings of [[], [toastSettings({ enabled: false })]]) {
      const f = notInToastClient(base({ catering_toast_settings: settings }));
      expect(await readHouseNotInToastWithState(f.client, "shop", THROUGH)).toEqual({ rows: [], house: "off" });
      expect(f.reads.map((r) => r.table)).not.toContain("catering_reconciliation_status");
    }
  });
  it.each(["42P01", "PGRST205"])("not_installed: 0344 missing (%s)", async (code) => {
    expect(await readHouseNotInToastWithState(notInToastClient(base({ catering_toast_settings: { code, message: "x" } })).client, "shop", THROUGH))
      .toEqual({ rows: [], house: "not_installed" });
  });
  it("any other failure throws (never an empty list)", async () => {
    await expect(readHouseNotInToastWithState(notInToastClient(base({ catering_toast_settings: { code: "57014", message: "t" } })).client, "shop", THROUGH)).rejects.toThrow();
    await expect(readHouseNotInToastWithState(notInToastClient(base({ catering_reconciliation_status: { code: "57014", message: "t" } })).client, "shop", THROUGH)).rejects.toThrow();
  });
  it("B1: an exempt house order (no_ring_expected, no Toast link) is no row: house on, nothing listed", async () => {
    const r = await readHouseNotInToastWithState(notInToastClient(base({ catering_reconciliation_status: [houseRow({ lead_id: "exempt", status: "no_ring_expected", ring_code: null })] })).client, "shop", THROUGH);
    expect(r).toEqual({ rows: [], house: "on" });
  });
});

describe("readNotInToastScoped", () => {
  it("ezCater rows then house rows, with the state", async () => {
    const r = await readNotInToastScoped(notInToastClient(base()).client, "shop", THROUGH);
    expect(r.rows.map((x) => [x.order_id, x.source ?? "ezcater"])).toEqual([["ez1", "ezcater"], ["h1", "house"]]);
    expect(r.house).toBe("on");
  });
  it("ezCater clear + house off / not installed", async () => {
    expect(await readNotInToastScoped(notInToastClient(base({ ezcater_reconciliation_status: [], catering_toast_settings: [] })).client, "shop", THROUGH)).toEqual({ rows: [], house: "off" });
    expect(await readNotInToastScoped(notInToastClient(base({ ezcater_reconciliation_status: [], catering_toast_settings: { code: "42P01", message: "x" } })).client, "shop", THROUGH))
      .toEqual({ rows: [], house: "not_installed" });
  });
  it("only this shop's rows", async () => {
    const r = await readNotInToastScoped(notInToastClient(base({ ezcater_reconciliation_status: [ezRow(), ezRow({ order_id: "ez2", location_id: "other" })] })).client, "shop", THROUGH);
    expect(r.rows.map((x) => x.order_id)).toEqual(["ez1", "h1"]);
  });
  it("an ezCater view failure is a failure", async () => {
    await expect(readNotInToastScoped(notInToastClient(base({ ezcater_reconciliation_status: { code: "57014", message: "t" } })).client, "shop", THROUGH)).rejects.toBeDefined();
  });
  it("T-D3: under withAbortStrict every read carries the signal; an aborted signal builds no query", async () => {
    const f = notInToastClient(base());
    await readNotInToastScoped(withAbortStrict(f.client, new AbortController().signal), "shop", THROUGH);
    expect(f.reads.map((r) => r.table)).toEqual(["ezcater_reconciliation_status", "catering_toast_settings", "catering_reconciliation_status"]);
    expect(f.reads.every((r) => r.signal !== null)).toBe(true);
    const g = notInToastClient(base());
    const c = new AbortController(); c.abort();
    await expect(readNotInToastScoped(withAbortStrict(g.client, c.signal), "shop", THROUGH)).rejects.toBeDefined();
    expect(g.reads).toEqual([]);
  });
});

describe("readHouseNotInToast and readNotInToast: unchanged answers over the per-shop loop", () => {
  it("two shops, one on and one off; 0344 missing ends with no house rows", async () => {
    const t = base({ catering_toast_settings: [toastSettings()], catering_reconciliation_status: [houseRow(), houseRow({ lead_id: "h2", location_id: "two" })] });
    expect((await readHouseNotInToast(notInToastClient(t).client, ["shop", "two", "shop"], THROUGH)).map((r) => r.order_id)).toEqual(["h1"]);
    expect(await readHouseNotInToast(notInToastClient(base({ catering_toast_settings: { code: "42P01", message: "x" } })).client, ["shop", "two"], THROUGH)).toEqual([]);
    expect((await readNotInToast(notInToastClient(base()).client, ["shop"], THROUGH)).map((r) => r.order_id)).toEqual(["ez1", "h1"]);
  });
});
