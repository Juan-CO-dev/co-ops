/** Item 21 PR 2: Sales → Catering's "of this, $X is also rung in Toast" label. Read gate first, shop switch second,
 * the same windows as block 3, and a partition that does not sum is never shown. */
import { describe, expect, it, vi } from "vitest";
import { loadSalesPipelineToastLabel } from "@/lib/catering/catering-toast";
import type { SalesRange } from "@/lib/sales-reports-shared";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

const SHOP = "00000000-0000-4000-8000-000000000001", ELSEWHERE = "00000000-0000-4000-8000-000000000002";
const viewer = { userId: "u", level: 7, locations: [SHOP] };
const range = (from: string, to: string) => ({ from, to, empty: false }) as unknown as SalesRange;
const part = (cents: number) => ({ events: 1, value_cents: cents, unvalued: 0 });
/** The block-3 numbers the page DISPLAYED (loadSalesCatering's pipeline). */
const shown = (cents: number, events: number, unvalued = 0) => ({ completedEvents: events, completedCents: cents, completedUnvalued: unvalued,
  confirmedEvents: 0, confirmedCents: 0, confirmedUnvalued: 0 });

function client(opts: { settings?: unknown; rpc?: (args: Record<string, string>) => { data: unknown; error: unknown } }) {
  const calls: Array<Record<string, string>> = [];
  const reads: string[] = [];
  const sb = {
    from(table: string) {
      reads.push(table);
      const q = { select: () => q, eq: () => q, order: () => q,
        range: () => Promise.resolve(Array.isArray(opts.settings) ? { data: opts.settings, error: null } : { data: null, error: opts.settings }) };
      return q;
    },
    rpc(_fn: string, args: Record<string, string>) { calls.push(args); return Promise.resolve(opts.rpc!(args)); },
  };
  return { sb: sb as never, calls, reads };
}

describe("loadSalesPipelineToastLabel", () => {
  it("refuses a shop outside the viewer's scope before any read", async () => {
    const c = client({ settings: [] });
    await expect(loadSalesPipelineToastLabel(viewer, { locationId: ELSEWHERE, range: range("2026-11-01", "2026-11-30"), displayed: shown(0, 0) }, { client: c.sb })).rejects.toThrow();
    expect(c.reads).toEqual([]);
  });
  it("a shop that is off, or 0344 not applied, has no label", async () => {
    expect(await loadSalesPipelineToastLabel(viewer, { locationId: SHOP, range: range("2026-11-01", "2026-11-30"), displayed: shown(0, 0) }, { client: client({ settings: [] }).sb })).toBeNull();
    expect(await loadSalesPipelineToastLabel(viewer, { locationId: SHOP, range: range("2026-11-01", "2026-11-30"), displayed: shown(0, 0) },
      { client: client({ settings: { code: "42P01", message: "missing" } }).sb })).toBeNull();
  });
  it("sums the Sales windows (<= 31 days each) and returns the partition", async () => {
    const c = client({ settings: [{ location_id: "shop", enabled: true, include_toast_origin_leads: false }],
      rpc: () => ({ data: { total_events: 2, total_value_cents: 3000, total_unvalued: 0, parts: { rung_in_toast: part(1000), not_rung: part(2000) } }, error: null }) });
    const windows = 2; // 2026-10-01 .. 2026-11-30 = two Sales windows
    const label = await loadSalesPipelineToastLabel(viewer, { locationId: SHOP, range: range("2026-10-01", "2026-11-30"),
      displayed: shown(3000 * windows, 2 * windows) }, { client: c.sb });
    expect(c.calls.length).toBe(windows);
    expect(c.calls.length).toBeGreaterThan(1);
    for (const w of c.calls) expect(w.p_location_id).toBe(SHOP);
    expect(label).toMatchObject({ totalCents: 3000 * c.calls.length, parts: { rung_in_toast: 1000 * c.calls.length, not_rung: 2000 * c.calls.length } });
  });
  it("a partition that does not sum to its total is withheld; a read failure throws", async () => {
    const bad = client({ settings: [{ location_id: "shop", enabled: true }],
      rpc: () => ({ data: { total_events: 1, total_value_cents: 5000, total_unvalued: 0, parts: { rung_in_toast: part(1000) } }, error: null }) });
    expect(await loadSalesPipelineToastLabel(viewer, { locationId: SHOP, range: range("2026-11-01", "2026-11-10"), displayed: shown(5000, 1) }, { client: bad.sb })).toBeNull();
    const failing = client({ settings: [{ location_id: "shop", enabled: true }], rpc: () => ({ data: null, error: { code: "57014", message: "timeout" } }) });
    await expect(loadSalesPipelineToastLabel(viewer, { locationId: SHOP, range: range("2026-11-01", "2026-11-10"), displayed: shown(5000, 1) }, { client: failing.sb })).rejects.toThrow();
  });
  it("is checked against the DISPLAYED total: a pipeline change between the two reads hides it with a reason (review r1 P2 #2)", async () => {
    const c = () => client({ settings: [{ location_id: "shop", enabled: true }],
      rpc: () => ({ data: { total_events: 2, total_value_cents: 80000, total_unvalued: 0, parts: { rung_in_toast: part(30000), not_rung: part(50000) } }, error: null }) });
    const r = range("2026-11-01", "2026-11-10");
    // The block above showed $500 (an order confirmed / re-estimated in between): "Of this: $800" must never render.
    expect(await loadSalesPipelineToastLabel(viewer, { locationId: SHOP, range: r, displayed: shown(50000, 2) }, { client: c().sb })).toBe("changed");
    // Same money, another event or unvalued count: another snapshot too.
    expect(await loadSalesPipelineToastLabel(viewer, { locationId: SHOP, range: r, displayed: shown(80000, 3) }, { client: c().sb })).toBe("changed");
    expect(await loadSalesPipelineToastLabel(viewer, { locationId: SHOP, range: r, displayed: shown(80000, 2, 1) }, { client: c().sb })).toBe("changed");
    // Completed + confirmed equal to the partition: shown.
    const ok = await loadSalesPipelineToastLabel(viewer, { locationId: SHOP, range: r,
      displayed: { completedEvents: 1, completedCents: 30000, completedUnvalued: 0, confirmedEvents: 1, confirmedCents: 50000, confirmedUnvalued: 0 } }, { client: c().sb });
    expect(ok).toMatchObject({ totalCents: 80000 });
  });
  it("the page passes block 3's own numbers and renders the reason", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("app/(authed)/reports/sales/catering/page.tsx", "utf8");
    expect(page).toMatch(/loadSalesPipelineToastLabel\(viewer, \{ locationId: shopId, range, displayed: data\.pipeline \}\)/);
    expect(page).toMatch(/pipeline_toast\.changed/);
  });
});
