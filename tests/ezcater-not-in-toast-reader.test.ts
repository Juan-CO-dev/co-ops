import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import { loadCateringReader } from "@/lib/catering/ezcater-detail";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadNotInToast, readNotInToast } from "@/lib/catering/not-in-toast";
import type { NotInToastOrder } from "@/lib/catering/not-in-toast-shared";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn() }));
vi.mock("@/lib/catering/pipeline", () => ({ PIPELINE_READ_MIN: 5, CateringPipelineError: class extends Error {
  constructor(public status: number, public code: string) { super(code); }
} }));

type Row = NotInToastOrder & { status: string; rule?: string };
let rows: Row[];
let selects: string[];
let reads: string[];
let fail: boolean;
const actor = { user: { id: "actor", role: "owner" }, locations: ["other"] } as unknown as AuthContext;
const now = new Date("2026-10-08T16:00:00Z");
const make = (over: Partial<Row> = {}): Row => ({ order_id: "a", lead_id: "lead", location_id: "shop",
  event_date: "2026-10-08", order_number: "ABC123", handoff_time: "2026-10-08T15:00:00Z", event_timestamp: null,
  headcount: 10, total_cents: 12300, status: "not_rung_in_toast", ...over });

function client() {
  return { from(table: string) {
    reads.push(table);
    let filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let columns = "";
    const q = {
      select(s: string) { columns = s; selects.push(s); return q; },
      eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
      gte(k: string, v: string) { filters.push((r) => String(r[k]) >= v); return q; },
      lte(k: string, v: string) { filters.push((r) => String(r[k]) <= v); return q; },
      order() { return q; },
      range(from: number, to: number) {
        const source = table === "locations" ? [{ id: "shop" }, { id: "other" }] : rows;
        const data = source.filter((r) => filters.every((f) => f(r as unknown as Record<string, unknown>))).slice(from, to + 1)
          .map((r) => Object.fromEntries(columns.split(",").map((k) => [k, (r as unknown as Record<string, unknown>)[k]])));
        return Promise.resolve({ data: fail ? null : data, error: fail ? { message: "unavailable" } : null });
      },
    };
    return q;
  } } as unknown as ReturnType<typeof getServiceRoleClient>;
}

beforeEach(() => {
  vi.clearAllMocks(); rows = [make()]; selects = []; reads = []; fail = false;
  vi.mocked(loadCateringReader).mockResolvedValue({ role: "shift_lead", active: true, locations: ["shop"] });
  vi.mocked(getServiceRoleClient).mockReturnValue(client());
});

describe("not-in-Toast read policy and automatic clearance", () => {
  it.each<RoleCode>(["employee", "key_holder"])("refuses fresh %s despite owner JWT before projection reads", async (role) => {
    vi.mocked(loadCateringReader).mockResolvedValue({ role, active: true, locations: ["shop"] });
    await expect(loadNotInToast(actor, now)).rejects.toMatchObject({ status: 403 });
    expect(reads).toEqual([]);
  });
  it("fails closed for revoked user or membership-read failure", async () => {
    vi.mocked(loadCateringReader).mockResolvedValue(null);
    await expect(loadNotInToast(actor, now)).rejects.toMatchObject({ status: 403 });
    expect(reads).toEqual([]);
  });
  it("scopes shift-lead reads to fresh memberships and today/past dates", async () => {
    rows.push(make({ order_id: "past", event_date: "2026-10-07" }), make({ order_id: "other", location_id: "other" }),
      make({ order_id: "future", event_date: "2026-10-09" }));
    expect((await loadNotInToast(actor, now)).map((r) => r.order_id)).toEqual(["a", "past"]);
    expect(selects.join(",")).not.toMatch(/contact|payload|notes|address/);
  });
  it.each<RoleCode>(["catering_mgr", "moo", "owner", "cgs"])("permits fresh %s to read every shop", async (role) => {
    rows.push(make({ order_id: "other", location_id: "other" }));
    vi.mocked(loadCateringReader).mockResolvedValue({ role, active: true, locations: [] });
    expect(await loadNotInToast(actor, now)).toHaveLength(2);
  });
  it("empty membership scope issues no order reads", async () => {
    vi.mocked(loadCateringReader).mockResolvedValue({ role: "shift_lead", active: true, locations: [] });
    expect(await loadNotInToast(actor, now)).toEqual([]);
    expect(reads).toEqual([]);
  });
  it.each(["normalized_code", "late_code", "daily_batch"])("clears on next read after %s links, even a mismatch", async (rule) => {
    expect(await loadNotInToast(actor, now)).toHaveLength(1);
    rows[0] = make({ status: rule === "daily_batch" ? "amount_mismatch" : "matched", rule });
    expect(await loadNotInToast(actor, now)).toEqual([]);
  });
  it("reports overdue without requiring an opening schedule", async () => {
    expect((await loadNotInToast(actor, now))[0]?.overdue).toBe(true);
    rows[0] = make({ handoff_time: null });
    expect((await loadNotInToast(actor, now))[0]?.overdue).toBe(false);
  });
  it("propagates read errors instead of claiming an empty queue", async () => {
    fail = true;
    await expect(loadNotInToast(actor, now)).rejects.toThrow();
  });
  it("system seam requires scope and bounds both dates for a digest", async () => {
    rows.push(make({ order_id: "yesterday", event_date: "2026-10-07" }));
    expect(await readNotInToast(client(), [], { through: "2026-10-08" })).toEqual([]);
    expect(await readNotInToast(client(), ["shop"], { from: "2026-10-08", through: "2026-10-08" })).toHaveLength(1);
  });
});
