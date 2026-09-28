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
import { execFileSync } from "node:child_process";
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

// The first test cold-imports the real route (session + supabase modules); under a loaded
// machine that import alone can pass vitest's 5 s default, so this block gets 30 s.
describe("unauthenticated (real requireSession)", { timeout: 30_000 }, () => {
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

describe("the photo store (git-ignored, manifest-allowlisted)", () => {
  const m = {
    entries: { training: "t.js", data: "d.json" },
    files: { "t.js": "a".repeat(64), "d.json": "b".repeat(64) },
    photos: { [`cb-p-aioli-${"c".repeat(64)}.png`]: "c".repeat(64) },
  };
  const AIOLI = `cb-p-aioli-${"c".repeat(64)}.png`;

  it("photos/<name> resolves only for a manifest photo, as image/png from the photo store", async () => {
    const { coScenesAsset } = await import("@/lib/training/co-scenes-shared");
    expect(coScenesAsset(`photos/${AIOLI}`, m)).toEqual({
      rel: AIOLI, store: "photos", contentType: "image/png", sha256: "c".repeat(64),
    });
    expect(coScenesAsset("photos/other.png", m)).toBeNull();
    expect(coScenesAsset("photos/../t.js", m)).toBeNull();
    expect(coScenesAsset(AIOLI, m)).toBeNull(); // a photo is never a dist file
    expect(coScenesAsset("t.js", m)?.store).toBe("dist");
  });

  it("no photo is tracked by git, and the photo store is ignored", () => {
    const tracked = execFileSync("git", ["ls-files", "vendor", "public"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    expect(tracked.filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f) && !f.startsWith("public/brand/"))).toEqual([]);
    expect(tracked.filter((f) => f.startsWith("vendor/co-scenes/photos/"))).toEqual([]);
    // check-ignore exits 0 (no throw) only when the path IS ignored.
    expect(() => execFileSync("git", ["check-ignore", "-q", "--no-index", "vendor/co-scenes/photos/x.png"])).not.toThrow();
  });
});

describe("photos in a deploy: 302 to a 60 s signed URL, only after the session check", () => {
  const PHOTO = Object.keys((manifest as { photos?: Record<string, string> }).photos ?? {})[0]!;
  afterEach(() => {
    vi.doUnmock("@/lib/session");
    vi.doUnmock("@/lib/training/co-scenes-files");
    vi.doUnmock("@/lib/training/training-assets");
    vi.resetModules();
  });

  async function route(session: "valid" | "refused", signed: string | null) {
    vi.resetModules();
    const sign = vi.fn(async () => signed);
    vi.doMock("@/lib/session", () => ({
      requireSession: vi.fn(async () =>
        session === "valid" ? { user: { id: "u1" } } : NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      ),
    }));
    // No local dev store (a deploy): the file read misses, so storage is asked.
    vi.doMock("@/lib/training/co-scenes-files", () => ({ readCoScenesFile: vi.fn(() => null) }));
    vi.doMock("@/lib/training/training-assets", () => ({ signTrainingPhoto: sign }));
    const { GET } = await import("@/app/api/training/co-scenes/[...path]/route");
    return { GET, sign };
  }

  it("the vendored manifest lists photos (the real scene is vendored)", () => {
    expect(PHOTO).toMatch(/-[0-9a-f]{64}\.png$/);
  });

  it("valid session → 302 to the signed URL, never cached", async () => {
    const { GET, sign } = await route("valid", "https://x.supabase.co/storage/v1/object/sign/training-assets/co-scenes/p?token=t");
    const res = await GET(req(`photos/${PHOTO}`, "co_ops_session=ok"), params(`photos/${PHOTO}`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/object\/sign\/training-assets\//);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(sign).toHaveBeenCalledWith(PHOTO);
  });

  it("REVOKED session → 401 and nothing is signed", async () => {
    const { GET, sign } = await route("refused", "https://signed");
    const res = await GET(req(`photos/${PHOTO}`, "co_ops_session=revoked"), params(`photos/${PHOTO}`));
    expect(res.status).toBe(401);
    expect(sign).not.toHaveBeenCalled();
  });

  it("a photo storage does not have → 404 (the page falls back to the drawn look)", async () => {
    const { GET } = await route("valid", null);
    expect((await GET(req(`photos/${PHOTO}`, "co_ops_session=ok"), params(`photos/${PHOTO}`))).status).toBe(404);
  });

  it("a name the manifest does not list is never signed", async () => {
    const { GET, sign } = await route("valid", "https://signed");
    const bad = `photos/cb-evil-${"0".repeat(64)}.png`;
    expect((await GET(req(bad, "co_ops_session=ok"), params(bad))).status).toBe(404);
    expect(sign).not.toHaveBeenCalled();
  });

  it("a code file is never redirected to storage", async () => {
    const { GET, sign } = await route("valid", "https://signed");
    expect((await GET(req(TRAINING, "co_ops_session=ok"), params(TRAINING))).status).toBe(404);
    expect(sign).not.toHaveBeenCalled();
  });
});

describe("path shape is enforced at the gate AND at the filesystem join (DeepSeek P1)", () => {
  const sha = "c".repeat(64);
  const m = {
    entries: { training: "t.js" },
    files: { "t.js": "a".repeat(64), "../escape.js": "a".repeat(64), "chunks/../../x.js": "a".repeat(64), "a\b.js": "a".repeat(64) },
    photos: {
      [`cb-ok-${sha}.png`]: sha,
      [`..-${sha}.png`]: sha,
      [`a/../../etc-${sha}.png`]: sha,
      [`cb-lies-${"d".repeat(64)}.png`]: sha,
    },
  };

  it("a hostile manifest entry is still refused: traversal, separators, dot-leading, name/sha disagreement", async () => {
    const { coScenesAsset } = await import("@/lib/training/co-scenes-shared");
    expect(coScenesAsset(`photos/cb-ok-${sha}.png`, m)?.store).toBe("photos");
    expect(coScenesAsset(`photos/..-${sha}.png`, m)).toBeNull();
    expect(coScenesAsset(`photos/a/../../etc-${sha}.png`, m)).toBeNull();
    expect(coScenesAsset(`photos/cb-lies-${"d".repeat(64)}.png`, m)).toBeNull();
    expect(coScenesAsset("../escape.js", m)).toBeNull();
    expect(coScenesAsset("chunks/../../x.js", m)).toBeNull();
    expect(coScenesAsset("a\b.js", m)).toBeNull();
    expect(coScenesAsset("t.js", m)?.store).toBe("dist");
  });

  it("storePath refuses anything that would leave its store", async () => {
    const { storePath } = await import("@/lib/training/co-scenes-files");
    const root = path.resolve("x-root");
    expect(storePath("dist", "chunks/a.js", root)).toBe(path.join(root, "vendor", "co-scenes", "dist", "chunks", "a.js"));
    expect(storePath("photos", `cb-ok-${sha}.png`, root)).toBe(path.join(root, "vendor", "co-scenes", "photos", `cb-ok-${sha}.png`));
    for (const bad of ["../x.js", "chunks/../../x.js", "", "a//b.js", "/abs.js", "a\..\b.js"]) expect(storePath("dist", bad, root), bad).toBeNull();
    // Photos: EXACTLY one `<id>-<sha256>.png` segment at the join, not merely "a safe segment".
    for (const bad of ["../x.png", "a/b.png", "..png", "plain.png", "cb-x.png", `cb-x-${"c".repeat(63)}.png`, `.cb-${sha}.png`, `cb-${sha}.PNG`, `a/cb-${sha}.png`])
      expect(storePath("photos", bad, root), bad).toBeNull();
  });
});
