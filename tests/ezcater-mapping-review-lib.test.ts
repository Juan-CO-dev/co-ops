import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import { decideEzcaterMapping, loadEzcaterMappingReview } from "@/lib/admin/ezcater-review";
import { loadCateringReader } from "@/lib/catering/ezcater-detail";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn() }));
vi.mock("@/lib/supabase-paginate", () => ({ selectAllRows: vi.fn() }));
vi.mock("@/lib/catering/pipeline", () => ({ CateringPipelineError: class extends Error {
  constructor(public status: number, public code: string) { super(code); }
} }));
const rpc = vi.fn();
const review = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
function actor(unlocked = true, time: string | null = "2026-10-08T12:00:00Z"): AuthContext {
  return { user: { id: "actor", role: "owner" }, locations: [],
    session: { stepUpUnlocked: unlocked, stepUpUnlockedAt: time } } as unknown as AuthContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:30Z"));
  vi.stubEnv("ADMIN_STEP_UP_FRESH_SECONDS", "120");
  vi.mocked(loadCateringReader).mockResolvedValue({ role: "catering_mgr", active: true, locations: [] });
  vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(selectAllRows).mockResolvedValue([]);
  rpc.mockResolvedValue({ data: { decision: "approve" }, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("ezCater mapping review authorization", () => {
  it.each<RoleCode>(["catering_mgr", "moo", "owner", "cgs"])("allows the freshly loaded %s role", async (role) => {
    vi.mocked(loadCateringReader).mockResolvedValue({ role, active: true, locations: [] });
    await expect(decideEzcaterMapping(actor(), review, "approve", target)).resolves.toEqual({ decision: "approve" });
    expect(loadCateringReader).toHaveBeenCalledWith(actor());
  });
  it.each<RoleCode>(["gm", "agm", "prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "employee"])("rejects fresh %s even with owner JWT", async (role) => {
    vi.mocked(loadCateringReader).mockResolvedValue({ role, active: true, locations: [] });
    await expect(decideEzcaterMapping(actor(), review, "approve", target)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(loadEzcaterMappingReview(actor())).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
    expect(selectAllRows).not.toHaveBeenCalled();
  });
  it("rejects a deactivated or missing fresh user before any service-role read/write", async () => {
    vi.mocked(loadCateringReader).mockResolvedValue(null);
    await expect(decideEzcaterMapping(actor(), review, "ignore", null)).rejects.toMatchObject({ status: 403 });
    await expect(loadEzcaterMappingReview(actor())).rejects.toMatchObject({ status: 403 });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
  it.each([
    [false, "2026-10-08T12:00:00Z", "step_up_required"],
    [true, null, "step_up_stale"],
    [true, "2026-10-08T11:50:00Z", "step_up_stale"],
    [true, "2026-10-08T12:01:00Z", "step_up_stale"],
  ] as const)("requires fresh tier-B step-up (%s, %s)", async (unlocked, time, code) => {
    await expect(decideEzcaterMapping(actor(unlocked, time), review, "approve", target)).rejects.toMatchObject({ status: 403, code });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("allows authorized list reads without step-up", async () => {
    await expect(loadEzcaterMappingReview(actor(false))).resolves.toEqual({ candidates: [], targets: [] });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("groups repeated line identities at their current shop and excludes a stale transfer candidate", async () => {
    const identity = '["size",[]]';
    vi.mocked(selectAllRows)
      .mockResolvedValueOnce([
        { id: "old-review", order_id: "order", location_id: "old-shop", identity_key: identity, candidates: ["guid"] },
        { id: review, order_id: "order", location_id: "shop", identity_key: identity, candidates: ["guid"] },
        { id: "duplicate", order_id: "other-order", location_id: "shop", identity_key: identity, candidates: ["guid"] },
      ])
      .mockResolvedValueOnce([{ id: target, location_id: "shop", toast_item_guid: "guid", toast_item_name: "Sub" }])
      .mockResolvedValueOnce([{ id: "order", location_id: "shop" }, { id: "other-order", location_id: "shop" }])
      .mockResolvedValueOnce([{ id: "shop", name: "Current shop" }])
      .mockResolvedValueOnce([
        { order_id: "order", provider_item_uuid: "unique-line-1", menu_item_size_id: "size", pos_item_id: null, name: "Sub", options: [], private_note: "PRIVATE CUSTOMER" },
        { order_id: "other-order", provider_item_uuid: "unique-line-2", menu_item_size_id: "size", pos_item_id: null, name: "Sub", options: [] },
      ]);
    const result = await loadEzcaterMappingReview(actor());
    expect(result.candidates).toEqual([{ reviewId: review, identity, locationId: "shop", locationName: "Current shop",
      name: "Sub", size: "size", lineCount: 2, suggestedId: target }]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE CUSTOMER");
    expect(JSON.stringify(result)).not.toContain("old-review");
  });
});

describe("mapping decisions", () => {
  it.each([ ["approve", target], ["ignore", null] ] as const)("delegates %s atomically to the audited SQL authority", async (decision, targetId) => {
    await decideEzcaterMapping(actor(), review, decision, targetId);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("decide_ezcater_mapping", {
      p_review_id: review, p_toast_map_id: targetId, p_decision: decision, p_actor_id: "actor",
    });
  });
  it.each([
    ["bad-review", "approve", target], [review, "approve", null], [review, "approve", "bad-target"],
    [review, "ignore", target], [review, "invented", null],
  ] as const)("rejects invalid identity/target/decision (%s, %s, %s)", async (reviewId, decision, targetId) => {
    await expect(decideEzcaterMapping(actor(), reviewId, decision as "approve", targetId)).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["42883", "42P01", "42703", "PGRST202", "PGRST205"])("makes missing schema retryable (%s)", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE SQL DETAILS" } });
    await expect(decideEzcaterMapping(actor(), review, "approve", target)).rejects.toMatchObject({ status: 503, code: "ezcater_schema_unavailable" });
  });
  it.each([
    ["ezcater_mapping_forbidden", 403, "forbidden"],
    ["ezcater_mapping_review_not_found", 404, "not_found"],
    ["ezcater_mapping_source_changed", 409, "mapping_changed"],
    ["ezcater_mapping_target_invalid", 409, "mapping_changed"],
    ["PRIVATE SQL DETAILS", 503, "mapping_unavailable"],
  ] as const)("maps SQL refusal %s without leaking SQL details", async (message, status, code) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    await expect(decideEzcaterMapping(actor(), review, "approve", target)).rejects.toMatchObject({ status, code, message: code });
  });
  it("does not report success for an empty RPC result", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(decideEzcaterMapping(actor(), review, "ignore", null)).rejects.toMatchObject({ status: 503, code: "mapping_unavailable" });
  });
});
