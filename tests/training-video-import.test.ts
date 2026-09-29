import { describe, expect, it } from "vitest";
import { validateTrainingSidecar, assertFaststart, assertRendererRevision } from "@/lib/training/video-import-shared";
import { immutableWrite, verifyVideoBytes } from "@/scripts/import-training-video";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const steps = [{ n: 1, key: "whole", ingredient: null, amount: null, drawn: false }];
const stamps = { card_revision_sha: "a".repeat(64), scene_tree: "b".repeat(40), code_sha256: "c".repeat(64), display_sha256: "d".repeat(64), photo_manifest_sha256: "e".repeat(64), packages: { three: "1" }, render: { width: 720, height: 1280, fps: 30, three: "1", encoder: "libx264" }, env: { chromium: "1", ffmpeg: "1", fonts_sha256: "f".repeat(64) } };
const fixture = () => ({ format: "co-scenes-video/1", look: "stage", aspect: "9:16", width: 720, height: 1280, fps: 30, duration: 2, frames: 61, steps, step_times: [0, 2], illustrated: [], poster: `stage-720x1280-poster-${"a".repeat(16)}.jpg`, sources: [{ url: `stage-720x1280-${"b".repeat(16)}.mp4`, type: 'video/mp4; codecs="avc1.640028"', bytes: 10, sha256: "b".repeat(64) }], stamps });
const check = (sc: unknown) => validateTrainingSidecar(sc, { steps, stepTimes: [0, 2], duration: 2, stamps });
describe("training import contract", () => {
  it("accepts clean canonical stage and rejects drawn/dirty/wrong timing or step amounts", () => {
    expect(check(fixture()).look).toBe("stage");
    for (const change of [{ dirty: true }, { illustrated: [[0, 1]] }, { look: "studio" }, { fps: 24 }, { step_times: [0, 1.9] }, { frames: 60 }, { steps: [{ ...steps[0], amount: "99 oz" }] }, { stamps: { ...stamps, code_sha256: "0".repeat(64) } }]) expect(() => check({ ...fixture(), ...change })).toThrow();
  });
  it("accepts half-frame rounding, rejects missing provenance and unsafe media names", () => {
    expect(() => check({ ...fixture(), step_times: [0, 2 - 1 / 60] })).not.toThrow();
    for (const sc of [null, {}, { ...fixture(), stamps: {} }, { ...fixture(), poster: "../a.jpg" }, { ...fixture(), sources: [{ ...fixture().sources[0], bytes: 12 * 1024 * 1024 + 1 }] }]) expect(() => check(sc)).toThrow();
  });
  it("rejects each stale stamp while treating scene_commit as informational", () => {
    for (const key of Object.keys(stamps)) expect(() => check({ ...fixture(), stamps: { ...stamps, [key]: "stale" } })).toThrow();
    expect(() => check({ ...fixture(), stamps: { ...stamps, scene_commit: "1".repeat(40) } })).not.toThrow();
    expect(() => check({ ...fixture(), steps: [{ ...steps[0], drawn: true }] })).toThrow();
    expect(() => check({ ...fixture(), sources: [{ ...fixture().sources[0], url: "../a.mp4" }] })).toThrow();
  });
  it("pins the actual checkout HEAD, not last scene commit", () => {
    expect(() => assertRendererRevision("6dfa978" + "a".repeat(33), "6dfa978" + "a".repeat(33))).not.toThrow();
    expect(() => assertRendererRevision("a".repeat(40), "6dfa978" + "a".repeat(33))).toThrow();
  });
  it("requires a complete MP4 atom stream with moov before mdat", () => {
    const atom = (kind: string) => { const b = Buffer.alloc(8); b.writeUInt32BE(8); b.write(kind, 4); return b; };
    expect(() => assertFaststart(Buffer.concat([atom("ftyp"), atom("moov"), atom("mdat")]))).not.toThrow();
    for (const b of [Buffer.concat([atom("ftyp"), atom("mdat"), atom("moov")]), Buffer.from("junk"), atom("moov")]) expect(() => assertFaststart(b)).toThrow();
  });
  it("verifies repeated writes and refuses collisions without overwrite", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "training-import-"));
    const file = path.join(dir, "asset");
    try {
      immutableWrite(file, Buffer.from("one")); immutableWrite(file, Buffer.from("one"));
      expect(() => immutableWrite(file, Buffer.from("two"))).toThrow();
      expect(readFileSync(file, "utf8")).toBe("one");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("requires exact source size/full hash and hash16 poster name", () => {
    const bytes = Buffer.from("fixture");
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(() => verifyVideoBytes(bytes, { sha256: hash, bytes: bytes.length })).not.toThrow();
    expect(() => verifyVideoBytes(bytes, { sha256: hash, bytes: 1 })).toThrow();
    expect(() => verifyVideoBytes(bytes, { sha256: "a".repeat(64), bytes: bytes.length })).toThrow();
    expect(() => verifyVideoBytes(bytes, { hashPrefix: hash.slice(0, 16) })).not.toThrow();
    expect(() => verifyVideoBytes(bytes, { hashPrefix: "a".repeat(16) })).toThrow();
  });
});
