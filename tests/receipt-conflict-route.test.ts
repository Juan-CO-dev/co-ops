import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/operations/receiving/email-receipts/route";
import { requireSession, type AuthContext } from "@/lib/session";
import { moveConflictedReceipt } from "@/lib/email-receipts";
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/email-receipts", async () => ({ ...await vi.importActual<typeof import("@/lib/email-receipts")>("@/lib/email-receipts"), moveConflictedReceipt: vi.fn() }));
function request(origin = "https://example.com") {
  return new NextRequest("https://example.com/api/operations/receiving/email-receipts", { method: "PATCH",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ action: "move", receiptId: "receipt" }) });
}
beforeEach(() => vi.clearAllMocks());
it("refuses cross-origin moves before session access", async () => {
  expect((await PATCH(request("https://evil.example"))).status).toBe(403);
  expect(requireSession).not.toHaveBeenCalled();
  expect(moveConflictedReceipt).not.toHaveBeenCalled();
});
it.each([false, true])("Tier A unlocked=%s", async unlocked => {
  const actor = { user: { role: "moo" }, session: { stepUpUnlocked: unlocked }, locations: [] } as unknown as AuthContext;
  vi.mocked(requireSession).mockResolvedValue(actor);
  const response = await PATCH(request());
  expect(response.status).toBe(unlocked ? 200 : 403);
  expect(moveConflictedReceipt).toHaveBeenCalledTimes(unlocked ? 1 : 0);
});
