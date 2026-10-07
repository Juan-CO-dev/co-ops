import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/operations/counts/route";
import { requireSession } from "@/lib/session";
import { createCountEvent } from "@/lib/counts";
import { ROLES } from "@/lib/roles";
import { verifyActorPin } from "@/lib/auth-flows";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth-flows", () => ({ verifyActorPin: vi.fn() }));
vi.mock("@/lib/counts", () => ({
  COUNT_WRITE_MIN: 4,
  CountError: class extends Error {},
  createCountEvent: vi.fn(async () => ({ countEventId: "count-1", advisories: [] })),
}));

function request(pin?: string) {
  return new NextRequest("https://example.test/api/operations/counts", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ locationId: "shop", pin, lines: [{ skuId: "sku", levelLabel: "case", qty: 1 }] }),
  });
}
function session(level: number, unlocked: boolean) {
  const role = Object.values(ROLES).find((r) => r.level === level)!.code;
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "actor", role }, session: { stepUpUnlocked: unlocked } } as never);
}
beforeEach(() => vi.clearAllMocks());
describe("count confirmation follows the actor's credential tier", () => {
  it.each([4, 5])("level %s records with a correct re-entered PIN without password step-up", async (level) => {
    session(level, false);
    vi.mocked(verifyActorPin).mockResolvedValue(true);
    expect((await POST(request("1234"))).status).toBe(201);
    expect(verifyActorPin).toHaveBeenCalledWith("actor", "1234");
    expect(createCountEvent).toHaveBeenCalledOnce();
    expect(createCountEvent).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({ pin: expect.anything() }));
  });
  it.each([4, 5])("level %s cannot submit a wrong PIN even with a step-up flag", async (level) => {
    session(level, true);
    vi.mocked(verifyActorPin).mockResolvedValue(false);
    const response = await POST(request("0000"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "pin_invalid" });
    expect(createCountEvent).not.toHaveBeenCalled();
  });
  it.each([4, 5])("level %s cannot submit without a PIN", async (level) => {
    session(level, false);
    expect((await POST(request())).status).toBe(400);
    expect(verifyActorPin).not.toHaveBeenCalled();
    expect(createCountEvent).not.toHaveBeenCalled();
  });
  it.each([6, 7, 8, 9, 10])("refuses level %s without password step-up even when a PIN is provided", async (level) => {
    session(level, false);
    const response = await POST(request("1234"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "step_up_required" });
    expect(createCountEvent).not.toHaveBeenCalled();
    expect(verifyActorPin).not.toHaveBeenCalled();
  });
  it("records a count after the password gate is satisfied", async () => {
    session(6, true);
    expect((await POST(request())).status).toBe(201);
    expect(createCountEvent).toHaveBeenCalledOnce();
  });
});
