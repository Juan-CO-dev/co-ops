import { beforeEach, describe, expect, it, vi } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canDoOperationalTask } from "@/lib/operational-task-access";
import { loadPoHistory } from "@/lib/purchase-orders";
import { loadRecentDeliveries } from "@/lib/receiving";
import { loadOpenCreditsSummary } from "@/lib/credits";
import { loadRecentParPasses } from "@/lib/ordering";
import type { AuthContext } from "@/lib/session";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/operational-task-access", () => ({ auditOperationalTaskOverride: vi.fn(async () => {}), canDoOperationalTask: vi.fn(async () => false) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
const actor = { user: { id: "reader", role: "key_holder" }, role: "key_holder", level: 4, locations: ["shop"] } as AuthContext;
beforeEach(() => {
  vi.clearAllMocks();
  const q = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
    returns: async () => ({ data: [], error: null }) };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => q } as unknown as ReturnType<typeof getServiceRoleClient>);
});
describe("history does not depend on today's assignment", () => {
  for (const [name, load] of [["purchase orders", loadPoHistory], ["deliveries", loadRecentDeliveries],
    ["credits", loadOpenCreditsSummary], ["par passes", loadRecentParPasses]] as const) {
    it(`${name}: KH can read while the task belongs to somebody else`, async () => {
      await expect(load(actor, "shop")).resolves.toEqual([]);
      expect(canDoOperationalTask).not.toHaveBeenCalled();
    });
    it(`${name}: other shops remain hidden`, async () => {
      await expect(load(actor, "other")).rejects.toMatchObject({ status: 404 });
    });
    it(`${name}: employees remain below the history floor`, async () => {
      await expect(load({ ...actor, user: { ...actor.user, role: "employee" }, role: "employee", level: 3 }, "shop"))
        .rejects.toMatchObject({ status: 403 });
    });
  }
});
