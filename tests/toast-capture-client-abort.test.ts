import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("passes capture cancellation through authentication, reauthentication and the order fetch", async () => {
  vi.resetModules();
  vi.stubEnv("TOAST_FIXTURES", "0");
  vi.stubEnv("TOAST_CLIENT_ID", "synthetic");
  vi.stubEnv("TOAST_CLIENT_SECRET", "synthetic");
  const controller = new AbortController();
  const signals: (AbortSignal | null | undefined)[] = [];
  let reached: () => void = () => {};
  const inFlight = new Promise<void>((resolve) => { reached = resolve; });
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    signals.push(init?.signal);
    if (signals.length === 1 || signals.length === 3) {
      return Response.json({ token: { accessToken: "synthetic", expiresIn: 3600 } });
    }
    if (signals.length === 2) return new Response(null, { status: 401 });
    reached();
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
  });
  vi.stubGlobal("fetch", fetcher);
  const { toastGet } = await import("@/lib/toast/client");
  const pending = toastGet("/orders/v2/ordersBulk", "synthetic-restaurant", controller.signal);
  const rejected = expect(pending).rejects.toThrow("capture_deadline");
  await inFlight;
  controller.abort(new Error("capture_deadline"));
  await rejected;
  expect(signals).toEqual(Array(4).fill(controller.signal));
});
