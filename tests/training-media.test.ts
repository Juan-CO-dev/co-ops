import { describe, expect, it } from "vitest";
import { resolveMediaRange, mediaHeaders } from "@/lib/training/media-http";
import { coScenesAsset, coScenesEtag, type CoScenesManifest } from "@/lib/training/co-scenes-shared";

const sha = "a".repeat(64);
const etag = coScenesEtag(sha);
describe("single video ranges", () => {
  it.each([
    ["bytes=0-1", { status: 206, start: 0, end: 1, length: 2 }],
    ["bytes=8-", { status: 206, start: 8, end: 9, length: 2 }],
    ["bytes=-3", { status: 206, start: 7, end: 9, length: 3 }],
    ["bytes=8-999", { status: 206, start: 8, end: 9, length: 2 }],
    ["bytes=-99", { status: 206, start: 0, end: 9, length: 10 }],
    ["bytes=10-", { status: 416 }],
    ["bytes=-0", { status: 416 }],
    ["bytes=5-2", { status: 200, length: 10 }],
    ["bytes=0-1,4-5", { status: 200, length: 10 }],
    ["garbage", { status: 200, length: 10 }],
    ["bytes=9007199254740993-", { status: 416 }],
  ])("%s", (header, wanted) => expect(resolveMediaRange(header, null, etag, 10)).toEqual(wanted));
  it("matches only the actual strong validator byte-for-byte", () => {
    expect(resolveMediaRange("bytes=0-1", etag, etag, 10).status).toBe(206);
    for (const stale of [`W/${etag}`, '"old"', ` ${etag}`, "Tue, 29 Sep 2026 12:00:00 GMT"])
      expect(resolveMediaRange("bytes=0-1", stale, etag, 10)).toEqual({ status: 200, length: 10 });
  });
  it("Safari probe has exact response headers", () => {
    const range = resolveMediaRange("bytes=0-1", null, etag, 10);
    const h = mediaHeaders({ contentType: "video/mp4", sha256: sha, bytes: 10 }, range);
    expect(h.get("content-range")).toBe("bytes 0-1/10");
    expect(h.get("content-length")).toBe("2");
    expect(h.get("accept-ranges")).toBe("bytes");
    expect(h.get("etag")).toBe(etag);
    expect(h.get("content-disposition")).toBe("inline");
    expect(h.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("manifest video media allowlist", () => {
  const name = `training-${sha}.mp4`;
  const poster = `poster-${sha}.jpg`;
  const manifest: CoScenesManifest = { entries: { training: "t.js" }, files: {}, video: {
    sidecar: "video.json", source: { name, sha256: sha, bytes: 10, contentType: "video/mp4" },
    poster: { name: poster, sha256: sha, bytes: 10, contentType: "image/jpeg" },
  } };
  it("resolves typed media without polluting photos", () => {
    expect(coScenesAsset(`media/${name}`, manifest)).toMatchObject({ store: "photos", contentType: "video/mp4", bytes: 10, sha256: sha });
    expect(coScenesAsset(`media/${poster}`, manifest)?.contentType).toBe("image/jpeg");
    expect(coScenesAsset(`photos/${name}`, manifest)).toBeNull();
    expect(coScenesAsset(`media/other-${sha}.mp4`, manifest)).toBeNull();
  });
  it("rejects malicious metadata and name/hash/MIME disagreement", () => {
    for (const changed of [ { name: `../${name}` }, { sha256: "b".repeat(64) }, { bytes: 0 }, { bytes: 12*1024*1024+1 }, { contentType: "image/jpeg" } ]) {
      const m = structuredClone(manifest);
      Object.assign(m.video!.source, changed);
      expect(coScenesAsset(`media/${m.video!.source.name}`, m)).toBeNull();
    }
  });
});
