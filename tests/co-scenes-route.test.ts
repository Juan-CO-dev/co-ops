/**
 * tests/co-scenes-route.test.ts — the front door of the vendored co-scenes
 * bundle (app/api/training/co-scenes/[...path]/route.ts).
 *
 * The bundle is NOT in public/: it is served only through this route, behind
 * the same FULL session validation as the /training pages. Pinned here:
 *   1. No session cookie → 401 from the REAL requireSession (no DB is reached:
 *      a missing JWT is refused before any lookup).
 *   2. A session the full check refuses (revoked / idle-expired / token-hash
 *      mismatch — all collapse to requireSession's 401) → 401, and no file read.
 *   3. A valid session gets the manifest-named file with the right type,
 *      EXACTLY `Cache-Control: private, no-cache` and a strong ETag (the
 *      manifest sha256), so every reuse revalidates through requireSession; a
 *      matching If-None-Match is a 304 ONLY after the session check — a
 *      revoked session gets 401, never 304. A path the manifest does not name
 *      (including a traversal) is a flat 404.
 *   4. Nothing under public/ carries the bundle.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import manifest from "@/vendor/co-scenes/dist/asset-manifest.json";

const TRAINING = manifest.entries.training;
const req = (p: string, cookie?: string, ifNoneMatch?: string) => {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (ifNoneMatch) headers["if-none-match"] = ifNoneMatch;
  return new NextRequest(`https://example.com/api/training/co-scenes/${p}`, { headers });
};
const ETAG = `"${(manifest.files as Record<string, string>)[TRAINING]}"`;
const params = (p: string) => ({ params: Promise.resolve({ path: p.split("/") }) });

describe("unauthenticated (real requireSession)", () => {
  it("refuses a request with no session cookie — 401, no bytes", async () => {
    const { GET } = await import("@/app/api/training/co-scenes/[...path]/route");
    const res = await GET(req(TRAINING), params(TRAINING));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type") ?? "").not.toMatch(/javascript/);
  });

  it("refuses a no-cookie request carrying a matching If-None-Match — 401, not 304", async () => {
    const { GET } = await import("@/app/api/training/co-scenes/[...path]/route");
    const res = await GET(req(TRAINING, undefined, ETAG), params(TRAINING));
    expect(res.status).toBe(401);
  });

  it("refuses a request whose cookie is not a valid JWT — 401", async () => {
    const { GET } = await import("@/app/api/training/co-scenes/[...path]/route");
    const res = await GET(req(TRAINING, "co_ops_session=not-a-jwt"), params(TRAINING));
    expect(res.status).toBe(401);
  });
});

describe("with the session check mocked", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/session");
    vi.doUnmock("@/lib/training/co-scenes-files");
    vi.resetModules();
  });

  async function routeWith(session: "valid" | "refused") {
    vi.resetModules();
    const read = vi.fn();
    vi.doMock("@/lib/session", () => ({
      requireSession: vi.fn(async () =>
        session === "valid"
          ? { user: { id: "u1", language: "en" }, role: "employee", level: 3 }
          : NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      ),
    }));
    if (session === "refused") vi.doMock("@/lib/training/co-scenes-files", () => ({ readCoScenesFile: read }));
    const { GET } = await import("@/app/api/training/co-scenes/[...path]/route");
    return { GET, read };
  }

  it("a session the full check refuses (revoked, idle-expired) → 401 and the file is never read", async () => {
    const { GET, read } = await routeWith("refused");
    const res = await GET(req(TRAINING, "co_ops_session=revoked"), params(TRAINING));
    expect(res.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it("a valid session gets the manifest-named entry with EXACTLY private, no-cache + the strong sha256 ETag", async () => {
    const { GET } = await routeWith("valid");
    const res = await GET(req(TRAINING, "co_ops_session=ok"), params(TRAINING));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("etag")).toBe(ETAG);
    expect(ETAG).toMatch(/^"[0-9a-f]{64}"$/);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(readFileSync(path.join("vendor", "co-scenes", "dist", TRAINING)))).toBe(true);
  });

  it("valid session + matching If-None-Match → 304, no body, same exact headers", async () => {
    const { GET } = await routeWith("valid");
    const res = await GET(req(TRAINING, "co_ops_session=ok", ETAG), params(TRAINING));
    expect(res.status).toBe(304);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("etag")).toBe(ETAG);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it("valid session + a list containing the ETag → 304; a stale or weak ETag → 200 with the file", async () => {
    const { GET } = await routeWith("valid");
    expect((await GET(req(TRAINING, "co_ops_session=ok", `"stale", ${ETAG}`), params(TRAINING))).status).toBe(304);
    expect((await GET(req(TRAINING, "co_ops_session=ok", `"${"0".repeat(64)}"`), params(TRAINING))).status).toBe(200);
    expect((await GET(req(TRAINING, "co_ops_session=ok", `W/${ETAG}`), params(TRAINING))).status).toBe(200);
  });

  it("REVOKED session + matching If-None-Match → 401, never a 304", async () => {
    const { GET, read } = await routeWith("refused");
    const res = await GET(req(TRAINING, "co_ops_session=revoked", ETAG), params(TRAINING));
    expect(res.status).toBe(401);
    expect(res.headers.get("etag")).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("no cookie + matching If-None-Match → 401 from the real check (covered unmocked below too)", async () => {
    const { GET } = await routeWith("refused");
    expect((await GET(req(TRAINING, undefined, ETAG), params(TRAINING))).status).toBe(401);
  });

  it("serves a chunk by its nested manifest path", async () => {
    const chunk = Object.keys(manifest.files).find((f) => f.startsWith("chunks/"))!;
    const { GET } = await routeWith("valid");
    const res = await GET(req(chunk, "co_ops_session=ok"), params(chunk));
    expect(res.status).toBe(200);
  });

  it.each(["../../package.json", "asset-manifest.json", "nope.js", "chunks/../../VERSION", ".env.local"])(
    "a path the manifest does not name is a flat 404: %s",
    async (p) => {
      const { GET } = await routeWith("valid");
      const res = await GET(req("x", "co_ops_session=ok"), params(p));
      expect(res.status).toBe(404);
    },
  );
});

describe("nothing public", () => {
  it("the bundle is not under public/", () => {
    expect(existsSync(path.join("public", "vendor", "co-scenes"))).toBe(false);
    expect(existsSync(path.join("public", "vendor"))).toBe(false);
  });
});
