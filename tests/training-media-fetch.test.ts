import { afterEach, expect, it, vi } from "vitest";
const signed = "https://storage.invalid/private?token=fixture";
const sign = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ storage: { from: () => ({ createSignedUrl: sign }) } }) }));
import { fetchTrainingMedia } from "@/lib/training/training-assets";
afterEach(() => { vi.unstubAllGlobals(); sign.mockReset(); });
it("keeps signed URL server-side, refuses redirects, forwards canonical range and cancellation", async () => {
  sign.mockResolvedValue({ data: { signedUrl: signed }, error: null });
  const fetch = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", fetch);
  const abort = new AbortController();
  const response = await fetchTrainingMedia(`test-${"a".repeat(64)}.mp4`, "bytes=0-1", abort.signal);
  expect(response?.status).toBe(200);
  expect(fetch).toHaveBeenCalledWith(signed, expect.objectContaining({ redirect: "error", cache: "no-store", headers: { "Accept-Encoding": "identity", Range: "bytes=0-1" } }));
  const options = fetch.mock.calls[0] as unknown as [string, RequestInit];
  abort.abort(); expect(options[1].signal?.aborted).toBe(true);
});
it("sanitizes signing/fetch errors without exposing a URL or message", async () => {
  sign.mockResolvedValue({ data: { signedUrl: signed }, error: null });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(signed); }));
  expect(await fetchTrainingMedia(`test-${"a".repeat(64)}.jpg`, null, new AbortController().signal)).toBeNull();
});
it("request cancellation also bounds a hung signing call", async () => {
  sign.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  let settled = false;
  void fetchTrainingMedia(`test-${"a".repeat(64)}.mp4`, null, controller.signal).then(() => { settled = true; });
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settled).toBe(true);
});
