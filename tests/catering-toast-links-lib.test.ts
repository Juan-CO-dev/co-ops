/**
 * Item 21 PR 3: lib/catering/catering-toast-links.ts. The writer binds the actor and the shop BEFORE the RPC
 * (Juan answer 8), maps every refusal by name, retries only a deadlock, and never reports a success the database did
 * not return. The panel is null when the shop is off or 0344/0347 are missing, and a linked lead's panel lists the
 * link (with its head) instead of offering it again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { canReadCateringLead, loadCateringReader } from "@/lib/catering/ezcater-detail";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { decideCateringToastLink, loadHouseToastPanelFor } from "@/lib/catering/catering-toast-links";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn(), canReadCateringLead: vi.fn() }));
vi.mock("@/lib/catering/pipeline", () => ({ PIPELINE_READ_MIN: 5, CateringPipelineError: class extends Error {
  constructor(public status: number, public code: string) { super(code); }
} }));

const SHOP = "00000000-0000-4000-8000-000000000002", OTHER = "00000000-0000-4000-8000-000000000003", LEAD = "lead";
const actor = { user: { id: "actor" } } as AuthContext;
type Row = Record<string, unknown>;
let tables: Record<string, Row[] | { code: string; message: string }>;
let rpcResults: Array<{ data: unknown; error: { code?: string; message: string } | null }>;
let rpcCalls: Array<{ fn: string; args: Row }>;
let planRows: Row[];

function client() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const q = {
        select() { return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return q; },
        order() { return q; },
        rows() {
          const src = tables[table] ?? [];
          if (!Array.isArray(src)) return { data: null, error: src };
          return { data: src.filter((r) => filters.every((f) => f(r))), error: null };
        },
        range(from: number, to: number) { const r = q.rows(); return Promise.resolve(r.error ? r : { data: r.data!.slice(from, to + 1), error: null }); },
        maybeSingle() { const r = q.rows(); return Promise.resolve(r.error ? r : { data: r.data![0] ?? null, error: null }); },
      };
      return q;
    },
    rpc(fn: string, args: Row) {
      rpcCalls.push({ fn, args });
      if (fn === "plan_catering_toast") {
        const b = { order() { return b; }, range(from: number, to: number) { return Promise.resolve({ data: planRows.slice(from, to + 1), error: null, count: planRows.length }); } };
        return b;
      }
      return Promise.resolve(rpcResults.shift() ?? { data: null, error: { message: "no result" } });
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServiceRoleClient).mockReturnValue(client() as never);
  vi.mocked(canReadCateringLead).mockResolvedValue(true);
  vi.mocked(loadCateringReader).mockResolvedValue({ role: "catering_mgr", active: true, locations: [] });
  tables = {
    catering_pipeline: [{ id: LEAD, location_id: SHOP }],
    catering_toast_settings: [{ location_id: SHOP, enabled: true, include_toast_origin_leads: false }],
    catering_reconciliation_status: [{ lead_id: LEAD, location_id: SHOP, event_date: "2026-11-20", ring_code: null, value_cents: 30000, status: "not_rung_in_toast" }],
    catering_toast_decision_heads: [],
    catering_toast_links: [],
  };
  rpcResults = [];
  rpcCalls = [];
  planRows = [];
});

const link = { kind: "link" as const, locationId: SHOP, orderGuid: "o", checkGuid: "c", reasonCode: null, expectedHeadId: null };

describe("decideCateringToastLink", () => {
  it.each([["agm", [SHOP]], ["gm", [OTHER]], ["shift_lead", [SHOP]], ["social_media_mgr", [SHOP]]])("refuses %s at %j BEFORE the RPC", async (role, locations) => {
    vi.mocked(loadCateringReader).mockResolvedValue({ role: role as never, active: true, locations: locations as string[] });
    await expect(decideCateringToastLink(actor, LEAD, link)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(rpcCalls).toEqual([]);
  });
  it("a GM at the lead's shop decides; the RPC gets the actor and every key", async () => {
    vi.mocked(loadCateringReader).mockResolvedValue({ role: "gm", active: true, locations: [SHOP] });
    rpcResults = [{ data: { decision_id: "d1", kind: "link", link_id: "l1" }, error: null }];
    await expect(decideCateringToastLink(actor, LEAD, link)).resolves.toEqual({ decisionId: "d1", kind: "link", linkId: "l1" });
    expect(rpcCalls).toEqual([{ fn: "decide_catering_toast", args: { p_actor_id: "actor", p_lead_id: LEAD, p_kind: "link", p_location_id: SHOP,
      p_order_guid: "o", p_check_guid: "c", p_reason_code: null, p_expected_head_id: null } }]);
  });
  it.each([
    ["decision_moved", 409], ["check_owned_by_ezcater", 409], ["forbidden", 403], ["invalid_decision", 400], ["catering_toast_off", 409], ["lead_has_links", 409],
  ])("maps the SQL refusal %s to %s", async (message, status) => {
    rpcResults = [{ data: null, error: { code: "P0001", message } }];
    await expect(decideCateringToastLink(actor, LEAD, link)).rejects.toMatchObject({ status, code: message });
  });
  it("a missing function is 'not installed'; a deadlock is retried twice then named", async () => {
    rpcResults = [{ data: null, error: { code: "PGRST202", message: "x" } }];
    await expect(decideCateringToastLink(actor, LEAD, link)).rejects.toMatchObject({ status: 503, code: "catering_toast_unavailable" });
    rpcResults = [1, 2, 3].map(() => ({ data: null, error: { code: "40P01", message: "deadlock" } }));
    await expect(decideCateringToastLink(actor, LEAD, link)).rejects.toMatchObject({ status: 503, code: "catering_toast_retry" });
    expect(rpcCalls.filter((c) => c.fn === "decide_catering_toast")).toHaveLength(4);
  });
  it("an unknown error or an answer of the wrong kind is a failure, never a success", async () => {
    rpcResults = [{ data: null, error: { code: "XX000", message: "boom" } }];
    await expect(decideCateringToastLink(actor, LEAD, link)).rejects.toThrow("catering_toast_decision_failed");
    rpcResults = [{ data: { decision_id: "d", kind: "unlink" }, error: null }];
    await expect(decideCateringToastLink(actor, LEAD, link)).rejects.toThrow("catering_toast_decision_failed");
  });
  it("an unknown lead is 404 before the RPC", async () => {
    tables.catering_pipeline = [];
    await expect(decideCateringToastLink(actor, LEAD, link)).rejects.toMatchObject({ status: 404 });
    expect(rpcCalls).toEqual([]);
  });
});

describe("loadHouseToastPanelFor", () => {
  it("the catering read gate first", async () => {
    vi.mocked(canReadCateringLead).mockResolvedValue(false);
    await expect(loadHouseToastPanelFor(actor, LEAD)).rejects.toMatchObject({ status: 403 });
  });
  it("null when the shop is off or 0344/0347 are missing", async () => {
    tables.catering_toast_settings = [];
    expect(await loadHouseToastPanelFor(actor, LEAD)).toBeNull();
    tables.catering_toast_settings = { code: "42P01", message: "missing" };
    expect(await loadHouseToastPanelFor(actor, LEAD)).toBeNull();
  });
  it("a linked lead lists its link with the head, and the linked check is not offered again", async () => {
    tables.catering_reconciliation_status = [{ ...(tables.catering_reconciliation_status as Row[])[0], status: "matched" }];
    tables.catering_toast_links = [{ lead_id: LEAD, is_current: true, location_id: SHOP, order_guid: "o", check_guid: "c", evidence: "manual" }];
    tables.catering_toast_decision_heads = [{ lead_id: LEAD, id: "h1", kind: "link", location_id: SHOP, order_guid: "o", check_guid: "c", reason_code: null }];
    tables.toast_orders_latest = [{ id: "snap", location_id: SHOP, order_guid: "o", business_date: "2026-11-20", voided: false, deleted: false, excess_food: false }];
    tables.toast_order_checks = [{ snapshot_id: "snap", check_guid: "c", total_cents: 30500, voided: false, deleted: false }];
    planRows = [{ lead_id: LEAD, location_id: SHOP, order_guid: "o", check_guid: "c", toast_snapshot_id: "snap", business_date: "2026-11-20",
      evidence: "amount_date", check_total_cents: 30500, lead_value_cents: 30000, amount_diff_cents: 500, amount_mismatch: false,
      dual_code: false, owner: "house", owner_lead_id: LEAD, blocked: false }];
    const panel = await loadHouseToastPanelFor(actor, LEAD);
    expect(panel?.status).toBe("matched");
    expect(panel?.links).toEqual([{ locationId: SHOP, orderGuid: "o", checkGuid: "c", evidence: "manual", totalCents: 30500, businessDate: "2026-11-20", live: true, headId: "h1" }]);
    expect(panel?.candidates).toEqual([]);
    expect(panel?.canDecide).toBe(true);
    expect(rpcCalls.find((c) => c.fn === "plan_catering_toast")?.args).toMatchObject({ p_location_id: SHOP, p_from: "2026-11-20", p_to: "2026-11-20" });
  });
  it("a viewer who may not decide gets the panel read-only", async () => {
    vi.mocked(loadCateringReader).mockResolvedValue({ role: "shift_lead", active: true, locations: [SHOP] });
    expect((await loadHouseToastPanelFor(actor, LEAD))?.canDecide).toBe(false);
  });
});
