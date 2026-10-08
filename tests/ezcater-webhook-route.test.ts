import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/ezcater/route";
import { processEzcaterDelivery } from "@/lib/catering/ezcater-intake";
vi.mock("@/lib/catering/ezcater-intake", () => ({ processEzcaterDelivery: vi.fn() }));
vi.mock("@/lib/ezcater/client", () => ({ ezcaterConfigured: () => true }));
vi.mock("@/lib/ezcater/webhook-shared", () => ({ verifyEzcaterSignature: () => true }));
vi.mock("@/lib/client-ip", () => ({ trustedClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/portal/rate-limit", () => ({ checkAndRecord: async () => true }));
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("EZCATER_WEBHOOK_SECRET", "test"); });
afterEach(() => { vi.unstubAllEnvs(); });
it("missing migration asks ezCater to retry with 503 and Retry-After", async () => {
  vi.mocked(processEzcaterDelivery).mockRejectedValue(new Error("ezcater_schema_unavailable"));
  const response = await POST(new NextRequest("https://example.test/api/webhooks/ezcater", { method: "POST", body: "{}" }));
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("60");
  expect(await response.json()).toMatchObject({ code: "ezcater_schema_unavailable" });
});
