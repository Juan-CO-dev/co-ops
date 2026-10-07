import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/operations/counts/route";
import { requireSession } from "@/lib/session";
import { createCountEvent } from "@/lib/counts";
import { ROLES } from "@/lib/roles";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/counts", () => ({
  COUNT_WRITE_MIN: 4,
  CountError: class extends Error {},
  createCountEvent: vi.fn(async () => ({ countEventId: "count-1", advisories: [] })),
}));

function request() {
  return new NextRequest("https://example.test/api/operations/counts", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ locationId: "shop", lines: [{ skuId: "sku", levelLabel: "case", qty: 1 }] }),
  });
}
function session(level: number, unlocked: boolean) {
  const role = Object.values(ROLES).find((r) => r.level === level)!.code;
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "actor", role }, session: { stepUpUnlocked: unlocked } } as never);
}
beforeEach(() => vi.clearAllMocks());
describe("count writes retain password step-up", () => {
  it.each([4, 5, 6, 7, 8, 9, 10])("refuses level %s without step-up before recording a count", async (level) => {
    session(level, false);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "step_up_required" });
    expect(createCountEvent).not.toHaveBeenCalled();
  });
  it("records a count after the password gate is satisfied", async () => {
    session(6, true);
    expect((await POST(request())).status).toBe(201);
    expect(createCountEvent).toHaveBeenCalledOnce();
  });
});
