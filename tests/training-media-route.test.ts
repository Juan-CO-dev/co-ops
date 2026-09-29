import { NextRequest, NextResponse } from "next/server";
import { afterEach, expect, it, vi } from "vitest";

const sha = "a".repeat(64);
const etag = `"${sha}"`;
const ctx = { params: Promise.resolve({ path: ["media", `training-${sha}.mp4`] }) };
afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/session"); vi.doUnmock("@/lib/training/co-scenes-shared"); vi.doUnmock("@/lib/training/co-scenes-files"); vi.doUnmock("@/lib/training/training-assets"); });
async function setup({ valid = true, local = false, poster = false, known = true, upstreamStatus = 206, upstreamHeaders = {} as Record<string, string> } = {}) {
  vi.resetModules();
  const contentType = poster ? "image/jpeg" : "video/mp4";
  const fetchMedia = vi.fn<(name: string, range: string | null, signal: AbortSignal) => Promise<Response>>(async () => new Response(new Uint8Array([1, 2]), {
    status: upstreamStatus, headers: { "content-type": contentType, "content-length": "2", ...(upstreamStatus === 206 ? { "content-range": "bytes 0-1/10" } : {}), "x-secret": "private", location: "https://private.invalid", ...upstreamHeaders },
  }));
  const readMedia = vi.fn(async () => local ? { body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.close(); } }) } : null);
  vi.doMock("@/lib/session", () => ({ requireSession: vi.fn(async () => valid ? { user: { id: "test" } } : NextResponse.json({ error: "unauthorized" }, { status: 401 })) }));
  vi.doMock("@/lib/training/co-scenes-shared", async () => {
    const original = await vi.importActual<typeof import("@/lib/training/co-scenes-shared")>("@/lib/training/co-scenes-shared");
    return { ...original, coScenesAsset: () => known ? { rel: `training-${sha}.${poster ? "jpg" : "mp4"}`, store: "photos", contentType, sha256: sha, bytes: 10 } : null };
  });
  vi.doMock("@/lib/training/co-scenes-files", () => ({ readCoScenesFile: vi.fn(), readCoScenesMedia: readMedia }));
  vi.doMock("@/lib/training/training-assets", () => ({ fetchTrainingMedia: fetchMedia, signTrainingPhoto: vi.fn() }));
  const route = await import("@/app/api/training/co-scenes/[...path]/route");
  const req = (headers: Record<string, string> = {}, method = "GET") => new NextRequest("https://example.com/api/training/co-scenes/media/test", { headers, method });
  return { ...route, fetchMedia, readMedia, req };
}
it.each([false, true])("range response is streamed and sanitized, local=%s", async (local) => {
  const { GET, req, fetchMedia } = await setup({ local });
  const r = await GET(req({ range: "bytes=0-1" }), ctx);
  expect(r.status).toBe(206);
  expect(r.headers.get("content-range")).toBe("bytes 0-1/10");
  expect(r.headers.get("content-length")).toBe("2");
  expect(r.headers.get("location")).toBeNull();
  expect(r.headers.get("x-secret")).toBeNull();
  expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2]);
  if (local) expect(fetchMedia).not.toHaveBeenCalled();
});
it("revoked conditional requests cannot touch local/storage or return 304", async () => {
  const { GET, HEAD, req, fetchMedia, readMedia } = await setup({ valid: false });
  for (const method of [GET, HEAD]) expect((await method(req({ "if-none-match": etag }), ctx)).status).toBe(401);
  expect(fetchMedia).not.toHaveBeenCalled(); expect(readMedia).not.toHaveBeenCalled();
});
it("HEAD ignores Range and has full length, no body and no storage fetch", async () => {
  const { HEAD, req, fetchMedia } = await setup();
  const r = await HEAD(req({ range: "bytes=0-1" }, "HEAD"), ctx);
  expect(r.status).toBe(200); expect(r.headers.get("content-length")).toBe("10");
  expect(await r.text()).toBe(""); expect(fetchMedia).not.toHaveBeenCalled();
});
it("unknown media cannot reach storage", async () => {
  const { GET, req, fetchMedia } = await setup({ known: false });
  expect((await GET(req(), ctx)).status).toBe(404); expect(fetchMedia).not.toHaveBeenCalled();
});
it("416 never opens the file", async () => {
  const { GET, req, fetchMedia, readMedia } = await setup();
  const r = await GET(req({ range: "bytes=10-" }), ctx);
  expect(r.status).toBe(416); expect(r.headers.get("content-range")).toBe("bytes */10");
  expect(fetchMedia).not.toHaveBeenCalled(); expect(readMedia).not.toHaveBeenCalled();
});
it.each([200, 302, 403, 500])("refuses unexpected upstream status %s without leaking details", async (upstreamStatus) => {
  const { GET, req } = await setup({ upstreamStatus });
  const r = await GET(req({ range: "bytes=0-1" }), ctx);
  expect(r.status).toBe(502); expect(r.headers.get("location")).toBeNull(); expect(await r.text()).toBe("");
});
it("posters use the same session gate", async () => {
  const { GET, req, fetchMedia } = await setup({ poster: true, valid: false });
  expect((await GET(req(), ctx)).status).toBe(401); expect(fetchMedia).not.toHaveBeenCalled();
});
it.each<Record<string, string>>([
  { "content-range": "bytes 1-2/10" }, { "content-length": "10" },
  { "content-type": "text/html" }, { "content-encoding": "gzip" },
])("refuses incorrect upstream metadata %j", async (upstreamHeaders) => {
  const { GET, req } = await setup({ upstreamHeaders });
  expect((await GET(req({ range: "bytes=0-1" }), ctx)).status).toBe(502);
});
it("If-Range mismatch sends a full request and 200", async () => {
  const { GET, req, fetchMedia } = await setup({ upstreamStatus: 200, upstreamHeaders: { "content-length": "10" } });
  const r = await GET(req({ range: "bytes=0-1", "if-range": '"stale"' }), ctx);
  expect(r.status).toBe(200); expect(r.headers.get("content-range")).toBeNull();
  expect(fetchMedia.mock.calls[0]?.[1]).toBeNull();
  await r.body?.cancel();
});
it("poster ignores ranges and is inline same-origin JPEG without a redirect", async () => {
  const { GET, req, fetchMedia } = await setup({ poster: true, upstreamStatus: 200, upstreamHeaders: { "content-length": "10" } });
  const r = await GET(req({ range: "bytes=0-1" }), ctx);
  expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe("image/jpeg");
  expect(r.headers.get("content-disposition")).toBe("inline"); expect(r.headers.get("location")).toBeNull();
  expect(fetchMedia.mock.calls[0]?.[1]).toBeNull(); await r.body?.cancel();
});
