import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/catering/ezcater-review/route";
import { requireSession } from "@/lib/session";
import { decideEzcaterCustomization, decideEzcaterMapping } from "@/lib/admin/ezcater-review";
import { CateringPipelineError } from "@/lib/catering/pipeline";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/admin/ezcater-review", () => ({ decideEzcaterMapping: vi.fn(), decideEzcaterCustomization: vi.fn(),
  decideEzcaterMappingDirect: vi.fn(), dismissEzcaterToastReview: vi.fn() }));
const actor = { user: { id: "actor", role: "catering_mgr" } };
function request(body: unknown) {
  return new NextRequest("https://example.test/api/admin/catering/ezcater-review", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue(actor as never);
  vi.mocked(decideEzcaterMapping).mockResolvedValue({ decision: "approve" });
  vi.mocked(decideEzcaterCustomization).mockResolvedValue({ decision: "approve" });
});

describe("ezCater mapping review route", () => {
  it.each([["approve", "target"], ["ignore", null]] as const)("delegates %s with the exact session path", async (decision, targetId) => {
    const response = await POST(request({ reviewId: "review", decision, targetId }));
    expect(requireSession).toHaveBeenCalledWith(expect.anything(), "/api/admin/catering/ezcater-review");
    expect(decideEzcaterMapping).toHaveBeenCalledWith(actor, "review", decision, targetId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });
  it("preserves an authentication refusal before touching the writer", async () => {
    const refusal = new NextResponse(null, { status: 401 });
    vi.mocked(requireSession).mockResolvedValue(refusal);
    expect(await POST(request({ reviewId: "review", decision: "ignore", targetId: null }))).toBe(refusal);
    expect(decideEzcaterMapping).not.toHaveBeenCalled();
  });
  it("validates and delegates a customization decision", async () => {
    const targetId = "00000000-0000-4000-8000-000000000002";
    const effects = [{ targetKind: "sku", targetId, disposition: "remove", portionQty: null, portionUnit: null, parentOnly: true }];
    const response = await POST(request({ reviewId: "review", kind: "customization", decision: "approve", effects, pickMenuItemId: null }));
    expect(response.status).toBe(200);
    expect(decideEzcaterCustomization).toHaveBeenCalledWith(actor, "review", "approve", effects, null);
  });
  it.each([null, [], {}, { reviewId: 4, decision: "ignore", targetId: null },
    { reviewId: "review", decision: "reopen", targetId: null },
    { reviewId: "review", decision: "approve", targetId: 4 },
    { reviewId: "review", decision: "ignore" },
  ])("rejects malformed request %j before invoking the authority", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(decideEzcaterMapping).not.toHaveBeenCalled();
  });
  it.each([[400, "invalid_payload"], [403, "forbidden"], [403, "step_up_required"],
    [403, "step_up_stale"], [404, "not_found"], [409, "mapping_changed"],
    [503, "ezcater_schema_unavailable"], [503, "mapping_unavailable"],
  ] as const)("preserves %s %s with Retry-After only for unavailable service", async (status, code) => {
    vi.mocked(decideEzcaterMapping).mockRejectedValue(new CateringPipelineError(status, code));
    const response = await POST(request({ reviewId: "review", decision: "approve", targetId: "target" }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(response.headers.get("Retry-After")).toBe(status === 503 ? "60" : null);
  });
  it("does not misreport unexpected writer failures as approval", async () => {
    vi.mocked(decideEzcaterMapping).mockRejectedValue(new Error("unexpected"));
    await expect(POST(request({ reviewId: "review", decision: "ignore", targetId: null }))).rejects.toThrow("unexpected");
  });
});
