/**
 * Item 21 PR 3: /api/catering/pipeline/[id]/toast-links. GET = the lead's link panel; POST = one decision through the
 * lib authority. Same-origin first; a malformed body never reaches the writer; the lib's refusals pass through by name.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/catering/pipeline/[id]/toast-links/route";
import { requireSession } from "@/lib/session";
import { decideCateringToastLink, loadHouseToastPanelFor } from "@/lib/catering/catering-toast-links";
import { CateringPipelineError } from "@/lib/catering/pipeline";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/catering/catering-toast-links", () => ({ decideCateringToastLink: vi.fn(), loadHouseToastPanelFor: vi.fn() }));
vi.mock("@/lib/catering/pipeline", () => ({ CateringPipelineError: class extends Error {
  constructor(public status: number, public code: string) { super(code); }
} }));

const SHOP = "00000000-0000-4000-8000-000000000002";
const ctx = { params: Promise.resolve({ id: "lead" }) };
const actor = { user: { id: "actor", role: "catering_mgr" } };
const url = "https://example.test/api/catering/pipeline/lead/toast-links";
function post(body: unknown, origin = "https://example.test") {
  return new NextRequest(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
const link = { kind: "link", locationId: SHOP, orderGuid: "o", checkGuid: "c", expectedHeadId: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue(actor as never);
  vi.mocked(decideCateringToastLink).mockResolvedValue({ decisionId: "d", kind: "link", linkId: "l" });
  vi.mocked(loadHouseToastPanelFor).mockResolvedValue(null);
});

describe("toast-links route", () => {
  it("GET returns the panel (null = nothing to show) for the session's own path", async () => {
    const res = await GET(new NextRequest(url), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ panel: null });
    expect(requireSession).toHaveBeenCalledWith(expect.anything(), "/api/catering/pipeline/lead/toast-links");
  });
  it("POST delegates the parsed decision to the lib authority", async () => {
    const res = await POST(post(link), ctx);
    expect(res.status).toBe(200);
    expect(decideCateringToastLink).toHaveBeenCalledWith(actor, "lead",
      { kind: "link", locationId: SHOP, orderGuid: "o", checkGuid: "c", reasonCode: null, expectedHeadId: null });
    expect(await res.json()).toMatchObject({ ok: true, result: { decisionId: "d" } });
  });
  it("a cross-origin POST is refused before the session or the writer", async () => {
    const res = await POST(post(link, "https://evil.test"), ctx);
    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
    expect(decideCateringToastLink).not.toHaveBeenCalled();
  });
  it.each([null, [], { kind: "link" }, { ...link, reasonCode: "comped" }, { kind: "no_ring_expected", expectedHeadId: null }])(
    "a malformed body %j never reaches the writer", async (body) => {
      expect((await POST(post(body), ctx)).status).toBe(400);
      expect(decideCateringToastLink).not.toHaveBeenCalled();
    });
  it.each([[403, "forbidden"], [409, "decision_moved"], [409, "check_owned_by_ezcater"], [503, "catering_toast_unavailable"]])(
    "passes the lib's %s %s through by name", async (status, code) => {
      vi.mocked(decideCateringToastLink).mockRejectedValue(new CateringPipelineError(status, code));
      const res = await POST(post(link), ctx);
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ code });
    });
});
