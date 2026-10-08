import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/catering/pipeline/[id]/transfer/route";
import { requireSession } from "@/lib/session";
import { transferCateringLead } from "@/lib/catering/transfers";
import { CateringPipelineError } from "@/lib/catering/pipeline";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/catering/transfers", () => ({ transferCateringLead: vi.fn() }));
const ctx = { params: Promise.resolve({ id: "lead" }) };
const actor = { user: { id: "actor", role: "catering_mgr" } };
function request(body: unknown) {
  return new NextRequest("https://example.test/api/catering/pipeline/lead/transfer", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue(actor as never);
  vi.mocked(transferCateringLead).mockResolvedValue({} as never);
});
describe("catering transfer route", () => {
  it("returns retryable 503 until transfer schema is deployed", async () => {
    vi.mocked(transferCateringLead).mockRejectedValue(new CateringPipelineError(503, "catering_transfer_unavailable"));
    const response = await POST(request({ locationId: "shop", reason: "capacity" }), ctx);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
  });
  it("uses the exact step-up-preserving path and delegates to the lib authority", async () => {
    const body = { locationId: "destination", reason: "capacity", note: "Kitchen capacity" };
    expect((await POST(request(body), ctx)).status).toBe(200);
    expect(requireSession).toHaveBeenCalledWith(expect.anything(), "/api/catering/pipeline/lead/transfer");
    expect(transferCateringLead).toHaveBeenCalledWith(actor, "lead", body);
  });
  it.each([null, [], {}, { locationId: "shop", reason: "invented" }, { locationId: "shop", reason: "capacity", note: 4 }])(
    "rejects malformed payload %j before calling the writer", async (body) => {
      expect((await POST(request(body), ctx)).status).toBe(400);
      expect(transferCateringLead).not.toHaveBeenCalled();
    },
  );
  it.each(["forbidden", "step_up_required", "step_up_stale"])("returns the lib's %s refusal", async (code) => {
    vi.mocked(transferCateringLead).mockRejectedValue(new CateringPipelineError(403, code));
    const response = await POST(request({ locationId: "shop", reason: "capacity" }), ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code });
  });
});
