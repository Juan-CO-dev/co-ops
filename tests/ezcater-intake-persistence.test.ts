import { beforeEach, expect, it, vi } from "vitest";
import { processEzcaterDelivery } from "@/lib/catering/ezcater-intake";
import { syncEzcaterOrder } from "@/lib/ezcater/sync";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/ezcater/sync", () => ({ syncEzcaterOrder: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
const rows: Record<string, unknown>[] = [];
const body = JSON.stringify({ id: "notification", entity_type: "Order",
  entity_id: "00000000-0000-4000-8000-000000000001", parent_id: "caterer", key: "accepted",
  contact: { email: "private@example.test" } });
beforeEach(() => {
  vi.clearAllMocks(); rows.length = 0;
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => ({ insert: (row: Record<string, unknown>) => {
    rows.push(row); return { select: () => ({ maybeSingle: async () => ({ data: { id: "receipt" }, error: null }) }) };
  } }) } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(syncEzcaterOrder).mockImplementation(async () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]?.processing_result).toBe("error:sync_pending");
    return { lead_id: "lead", result: "created_lead_confirmed" };
  });
});

it("persists a sanitized receipt before provider work and links its resulting lead", async () => {
  expect(await processEzcaterDelivery(body, true)).toEqual({ result: "created_lead_confirmed" });
  expect(rows[1]).toMatchObject({ processing_result: "created_lead_confirmed", lead_id: "lead" });
  expect(JSON.stringify(rows)).not.toContain("private@example.test");
});
it("invalid signatures never fetch or retain untrusted payload text", async () => {
  expect(await processEzcaterDelivery(body, false)).toEqual({ result: "invalid_signature" });
  expect(syncEzcaterOrder).not.toHaveBeenCalled();
  expect(rows[0]?.raw).toEqual({});
});
it("propagates failed apply/retry persistence so the provider can retry", async () => {
  vi.mocked(syncEzcaterOrder).mockRejectedValue(new Error("apply_failed"));
  await expect(processEzcaterDelivery(body, true)).rejects.toThrow("apply_failed");
  expect(rows).toHaveLength(1);
});
