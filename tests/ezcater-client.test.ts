import { afterEach, describe, expect, it, vi } from "vitest";
import { ezcaterGraphql } from "@/lib/ezcater/client";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("ezCater bounded sanitized transport", () => {
  it("discards GraphQL message text including embedded private values", async () => {
    vi.stubEnv("EZCATER_API_TOKEN", "synthetic-test-only");
    vi.stubEnv("EZCATER_FIXTURES", "0");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      errors: [{ message: "Unknown field email for private@example.test", extensions: { code: "PRIVATE_TEXT" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(ezcaterGraphql("test", "query test { test }")).rejects.toMatchObject({ code: "graphql_error", message: "graphql_error" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("makes no request when the absolute deadline has expired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(ezcaterGraphql("test", "query test { test }", undefined, { deadlineMs: Date.now() - 1 }))
      .rejects.toMatchObject({ code: "timeout" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("attaches an abort signal and sanitizes transport errors", async () => {
    vi.stubEnv("EZCATER_API_TOKEN", "synthetic-test-only");
    vi.stubEnv("EZCATER_FIXTURES", "0");
    const fetchMock = vi.fn().mockRejectedValue(new Error("private@example.test"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(ezcaterGraphql("test", "query test { test }", undefined, { deadlineMs: Date.now() + 1000 }))
      .rejects.toMatchObject({ code: "network_error", message: "network_error" });
    expect(fetchMock.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });
});
