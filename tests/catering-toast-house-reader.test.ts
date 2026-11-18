/**
 * Item 21 PR 2: house rows join the not-rung list through the ONE system seam (readNotInToast), so all four consumers
 * (pipeline, pulse, both digests) see them (plan r2 F7 pin), only for an enabled shop, and a missing 0344 is "not
 * installed" — never a failure of the ezCater list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { loadCateringReader } from "@/lib/catering/ezcater-detail";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadNotInToast, readNotInToast } from "@/lib/catering/not-in-toast";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn() }));
vi.mock("@/lib/catering/pipeline", () => ({ PIPELINE_READ_MIN: 5, CateringPipelineError: class extends Error {
  constructor(public status: number, public code: string) { super(code); }
} }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[] | { code: string; message: string }>;
let reads: string[];
let rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
let planRows: Row[] | { code: string; message: string };
let pages: Array<{ from: number; to: number; orders: string[]; count?: string }>;
let countOverride: ((page: number) => number | null) | null;

function client() {
  return {
    from(table: string) {
      reads.push(table);
      const filters: Array<(row: Row) => boolean> = [];
      let columns = "";
      const q = {
        select(s: string) { columns = s; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        gte(k: string, v: string) { filters.push((r) => String(r[k]) >= v); return q; },
        lte(k: string, v: string) { filters.push((r) => String(r[k]) <= v); return q; },
        order() { return q; },
        range(from: number, to: number) {
          const source = table === "locations" ? [{ id: "shop" }, { id: "other" }] : tables[table] ?? [];
          if (!Array.isArray(source)) return Promise.resolve({ data: null, error: source });
          const data = source.filter((r) => filters.every((f) => f(r))).slice(from, to + 1)
            .map((r) => Object.fromEntries(columns.split(",").map((k) => [k, r[k]])));
          return Promise.resolve({ data, error: null });
        },
      };
      return q;
    },
    rpc(fn: string, args: Record<string, unknown>, opts?: { count?: string }) {
      rpcs.push({ fn, args });
      const orders: string[] = [];
      const b = {
        order(k: string) { orders.push(k); return b; },
        range(from: number, to: number) {
          pages.push({ from, to, orders: [...orders], count: opts?.count });
          if (!Array.isArray(planRows)) return Promise.resolve({ data: null, error: planRows, count: null });
          const count = countOverride ? countOverride(pages.length) : planRows.length;
          return Promise.resolve({ data: planRows.slice(from, to + 1), error: null, count });
        },
      };
      return b;
    },
  } as unknown as ReturnType<typeof getServiceRoleClient>;
}

const ez = { order_id: "ez1", lead_id: "ezlead", location_id: "shop", event_date: "2026-11-20", order_number: "ABC123",
  handoff_time: null, event_timestamp: null, headcount: 10, total_cents: 1000, status: "not_rung_in_toast" };
const house = (over: Row = {}): Row => ({ lead_id: "h1", location_id: "shop", event_date: "2026-11-20", lead_source: "portal",
  ring_code: "CO-4KM7R", headcount: 20, value_cents: 50000, toast_origin: false, status: "not_rung_in_toast", ...over });
const settings = (over: Row = {}): Row => ({ location_id: "shop", enabled: true, include_toast_origin_leads: false, ...over });
const now = new Date("2026-11-20T16:00:00Z");
const actor = { user: { id: "actor", role: "gm" }, locations: ["shop"] } as unknown as AuthContext;

beforeEach(() => {
  vi.clearAllMocks();
  reads = []; rpcs = []; planRows = []; pages = []; countOverride = null;
  tables = { ezcater_reconciliation_status: [ez], catering_toast_settings: [settings()], catering_reconciliation_status: [house()] };
  vi.mocked(loadCateringReader).mockResolvedValue({ role: "gm", active: true, locations: ["shop"] });
  vi.mocked(getServiceRoleClient).mockReturnValue(client());
});

describe("readNotInToast: the one seam all four consumers read", () => {
  it("appends an enabled shop's house rows after its ezCater rows", async () => {
    const rows = await readNotInToast(client(), ["shop"], { through: "2026-11-20" });
    expect(rows.map((r) => [r.order_id, r.source ?? "ezcater"])).toEqual([["ez1", "ezcater"], ["h1", "house"]]);
    expect(rows[1]).toMatchObject({ order_number: "CO-4KM7R", total_cents: 50000, lead_id: "h1" });
  });
  it("a shop with no settings row, or enabled = false, reads no house view at all", async () => {
    tables.catering_toast_settings = [];
    expect((await readNotInToast(client(), ["shop"], { through: "2026-11-20" })).map((r) => r.order_id)).toEqual(["ez1"]);
    expect(reads).not.toContain("catering_reconciliation_status");
    tables.catering_toast_settings = [settings({ enabled: false })];
    expect((await readNotInToast(client(), ["shop"], { through: "2026-11-20" })).map((r) => r.order_id)).toEqual(["ez1"]);
  });
  it("0344 not applied = not installed: the ezCater list is unchanged", async () => {
    tables.catering_toast_settings = { code: "42P01", message: "relation does not exist" };
    expect((await readNotInToast(client(), ["shop"], { through: "2026-11-20" })).map((r) => r.order_id)).toEqual(["ez1"]);
    tables.catering_toast_settings = { code: "PGRST205", message: "not in schema cache" };
    expect((await readNotInToast(client(), ["shop"], { through: "2026-11-20" })).map((r) => r.order_id)).toEqual(["ez1"]);
  });
  it("any other failure is a failure, never an empty house list", async () => {
    tables.catering_toast_settings = { code: "57014", message: "timeout" };
    await expect(readNotInToast(client(), ["shop"], { through: "2026-11-20" })).rejects.toThrow();
    tables.catering_toast_settings = [settings()];
    tables.catering_reconciliation_status = { code: "57014", message: "timeout" };
    await expect(readNotInToast(client(), ["shop"], { through: "2026-11-20" })).rejects.toThrow();
  });
  it("Toast-origin leads only once the shop lists them; non-not-rung rows never", async () => {
    tables.catering_reconciliation_status = [house({ lead_id: "origin", toast_origin: true, lead_source: "toast_catering" }), house({ lead_id: "linked", status: "matched" })];
    expect((await readNotInToast(client(), ["shop"], { through: "2026-11-20" })).map((r) => r.order_id)).toEqual(["ez1"]);
    tables.catering_toast_settings = [settings({ include_toast_origin_leads: true })];
    expect((await readNotInToast(client(), ["shop"], { through: "2026-11-20" })).map((r) => r.order_id)).toEqual(["ez1", "origin"]);
  });
  it("bounds both dates for a digest", async () => {
    tables.catering_reconciliation_status = [house({ lead_id: "old", event_date: "2026-11-19" }), house({ lead_id: "today" })];
    expect((await readNotInToast(client(), ["shop"], { from: "2026-11-20", through: "2026-11-20" })).map((r) => r.order_id)).toEqual(["ez1", "today"]);
  });
  it("selects no contact, payload or note column", async () => {
    const selected: string[] = [];
    const base = client();
    const spy = { ...base, from(t: string) { const q = base.from(t); const sel = q.select.bind(q); q.select = ((s: string) => { selected.push(s); return sel(s); }) as typeof q.select; return q; } };
    await readNotInToast(spy as unknown as ReturnType<typeof getServiceRoleClient>, ["shop"], { through: "2026-11-20" });
    expect(selected.join(",")).not.toMatch(/contact|phone|email|payload|notes|address|company/);
  });
});

describe("loadNotInToast: suggestions on house rows for the pipeline", () => {
  it("attaches the best suggestion from the bounded planner, for that shop and window", async () => {
    planRows = [{ lead_id: "h1", location_id: "shop", order_guid: "o", check_guid: "c", toast_snapshot_id: "s", business_date: "2026-11-20",
      evidence: "ring_code", check_total_cents: 50000, lead_value_cents: 50000, amount_diff_cents: 0, amount_mismatch: false,
      dual_code: false, owner: null, owner_lead_id: null, blocked: false }];
    const rows = await loadNotInToast(actor, now);
    const h = rows.find((r) => r.order_id === "h1");
    expect(h?.suggestion).toMatchObject({ count: 1, conflicts: 0, best: { checkGuid: "c", evidence: "ring_code" } });
    expect(rows.find((r) => r.order_id === "ez1")?.suggestion).toBeUndefined();
    expect(rpcs).toEqual([{ fn: "plan_catering_toast", args: { p_location_id: "shop", p_from: "2026-11-20", p_to: "2026-11-20", p_note_codes: [] } }]);
  });
  it("a failed suggestion read keeps the row (suggestion: null), it never hides it", async () => {
    planRows = { code: "57014", message: "timeout" };
    const h = (await loadNotInToast(actor, now)).find((r) => r.order_id === "h1");
    expect(h).toBeDefined();
    expect(h?.suggestion).toBeNull();
  });
  it("reads the planner to completion past 1,000 rows, in a total order (review r1 P2 #1)", async () => {
    const plan = (lead: string, i: number, over: Row = {}): Row => ({ lead_id: lead, location_id: "shop", order_guid: `o${String(i).padStart(5, "0")}`,
      check_guid: "c", toast_snapshot_id: "s", business_date: "2026-11-20", evidence: "amount_date", check_total_cents: 50000 + i,
      lead_value_cents: 50000, amount_diff_cents: i, amount_mismatch: false, dual_code: false, owner: null, owner_lead_id: null, blocked: false, ...over });
    tables.catering_reconciliation_status = [house({ lead_id: "a" }), house({ lead_id: "z" })];
    // 1,500 candidate pairs for the early lead, then the late lead's: one best (ring code), one owned by ezCater.
    planRows = [...Array.from({ length: 1500 }, (_, i) => plan("a", i + 10)),
      plan("z", 1, { evidence: "ring_code", order_guid: "late" }), plan("z", 2, { owner: "ezcater", order_guid: "late2" })];
    const rows = await loadNotInToast(actor, now);
    expect(rows.find((r) => r.order_id === "z")?.suggestion).toMatchObject({ count: 1, conflicts: 1, best: { orderGuid: "late", evidence: "ring_code" } });
    expect(rows.find((r) => r.order_id === "a")?.suggestion).toMatchObject({ count: 1500 });
    expect(pages.map((p) => [p.from, p.to])).toEqual([[0, 999], [1000, 1999]]);
    for (const p of pages) { expect(p.orders).toEqual(["lead_id", "order_guid", "check_guid"]); expect(p.count).toBe("exact"); }
  });
  it("a planner read whose count moves or is missing is refused, never a partial answer (the row stays listed)", async () => {
    tables.catering_reconciliation_status = [house({ lead_id: "z" })];
    planRows = Array.from({ length: 1200 }, (_, i) => ({ lead_id: "z", location_id: "shop", order_guid: `o${i}`, check_guid: "c", toast_snapshot_id: "s",
      business_date: "2026-11-20", evidence: "amount_date", check_total_cents: 1, lead_value_cents: 1, amount_diff_cents: 0, amount_mismatch: false,
      dual_code: false, owner: null, owner_lead_id: null, blocked: false }));
    countOverride = (page) => page === 1 ? 1200 : 1300;
    expect((await loadNotInToast(actor, now)).find((r) => r.order_id === "z")?.suggestion).toBeNull();
    pages = [];
    countOverride = () => null;
    expect((await loadNotInToast(actor, now)).find((r) => r.order_id === "z")?.suggestion).toBeNull();
  });
  it("no house rows = no planner call", async () => {
    tables.catering_reconciliation_status = [];
    await loadNotInToast(actor, now);
    expect(rpcs).toEqual([]);
  });
});

describe("all four consumers read the one seam (plan r2 F7)", () => {
  it("pulse and both digests call readNotInToast; the pipeline calls loadNotInToast", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["lib/pulse/sections.ts", "lib/report-digests.ts", "lib/report-digests-v2.ts"]) {
      expect(readFileSync(file, "utf8")).toMatch(/readNotInToast\(/);
    }
    expect(readFileSync("app/(authed)/catering/pipeline/page.tsx", "utf8")).toMatch(/loadNotInToast\(/);
  });
});
