import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { isBaseMappingTarget, parseCustomizationDecision } from "@/lib/ezcater/customization-validation-shared";
import { decideEzcaterCustomization } from "@/lib/admin/ezcater-review";
import { loadCateringReader } from "@/lib/catering/ezcater-detail";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn() }));
vi.mock("@/lib/supabase-paginate", () => ({ selectAllRows: vi.fn() }));
vi.mock("@/lib/catering/pipeline", () => ({ CateringPipelineError: class extends Error {
  constructor(public status: number, public code: string) { super(code); }
} }));

const reviewId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002";
const actor = { user: { id: "actor", role: "owner" }, locations: [],
  session: { stepUpUnlocked: true, stepUpUnlockedAt: new Date().toISOString() } } as unknown as AuthContext;
const rpc = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCateringReader).mockResolvedValue({ role: "catering_mgr", active: true, locations: [] });
  vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
  rpc.mockResolvedValue({ data: { decision: "approve" }, error: null });
});

describe("ezCater customization decision validation", () => {
  it("excludes SKU targets from base mapping while preserving global and local packages", () => {
    const targets = [
      { kind: "sku", location_id: null }, { kind: "item", location_id: null },
      { kind: "menu_item", location_id: null }, { kind: "package", location_id: null },
      { kind: "package", location_id: "local" }, { kind: "package", location_id: "other" },
    ];
    expect(targets.filter((target) => isBaseMappingTarget(target, "local"))).toEqual(targets.slice(1, 5));
  });
  it("accepts multiple Toast-shaped effects and preserves parent_only", () => {
    expect(parseCustomizationDecision({ decision: "approve", pickMenuItemId: null, effects: [
      { targetKind: "sku", targetId, disposition: "remove", portionQty: null, portionUnit: null, parentOnly: true },
      { targetKind: "item", targetId, disposition: "deplete", portionQty: 0.5, portionUnit: "each", parentOnly: false },
    ] })).toMatchObject({ effects: [{ parentOnly: true }, { portionQty: 0.5 }] });
  });

  it.each([
    { decision: "approve", effects: [], pickMenuItemId: null },
    { decision: "ignore", effects: [{ targetKind: "item", targetId, disposition: "deplete", portionQty: 1, portionUnit: "each", parentOnly: false }], pickMenuItemId: null },
    { decision: "approve", effects: [{ targetKind: "sku", targetId, disposition: "deplete", portionQty: null, portionUnit: null, parentOnly: false }], pickMenuItemId: null },
    { decision: "approve", effects: [{ targetKind: "item", targetId: "bad", disposition: "deplete", portionQty: 1, portionUnit: "each", parentOnly: false }], pickMenuItemId: null },
    { decision: "approve", effects: [{ targetKind: "sku", targetId, disposition: "deplete", portionQty: 1, portionUnit: "slice", parentOnly: false }], pickMenuItemId: null },
    { decision: "approve", effects: [{ targetKind: "item", targetId, disposition: "deplete", portionQty: 1, portionUnit: "each", parentOnly: false }], pickMenuItemId: targetId },
  ])("rejects malformed or empty approvals %#", (payload) => expect(parseCustomizationDecision(payload)).toBeNull());

  it("requires the fresh live catering authority and sends the exact RPC payload", async () => {
    const effects = [{ targetKind: "sku" as const, targetId, disposition: "remove" as const,
      portionQty: null, portionUnit: null, parentOnly: true }];
    await decideEzcaterCustomization(actor, reviewId, "approve", effects, null);
    expect(rpc).toHaveBeenCalledWith("decide_ezcater_customization", {
      p_review_id: reviewId, p_decision: "approve", p_effects: effects,
      p_pick_menu_item_id: null, p_actor_id: "actor",
    });
    vi.mocked(loadCateringReader).mockResolvedValue({ role: "gm", active: true, locations: [] });
    await expect(decideEzcaterCustomization(actor, reviewId, "approve", effects, null)).rejects.toMatchObject({ status: 403 });
  });
});
