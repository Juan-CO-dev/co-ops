import { describe, expect, it } from "vitest";
import { buildAssetsFromHtml, publicConfigDigest, validateBuildReceipt, type BuildReceipt } from "../scripts/sim/launch-readiness/target";

const receipt: BuildReceipt = {
  candidateSha: "a".repeat(40), dirty: false, lockfileSha256: "b".repeat(64), policyVersion: "f1-v1",
  publicConfigDigest: "c".repeat(64), buildId: "candidate_123-abc", builtAt: "2026-09-09T12:00:00.000Z",
  nodeVersion: "v22.0.0", nextVersion: "16.2.4",
};
const { builtAt: _builtAt, ...expected } = receipt;
void _builtAt;

describe("sim build receipt", () => {
  it("accepts matching clean and dirty checkouts", () => {
    expect(validateBuildReceipt(receipt, expected)).toEqual(receipt);
    expect(validateBuildReceipt({ ...receipt, dirty: true }, { ...expected, dirty: true }).dirty).toBe(true);
  });
  for (const field of Object.keys(expected) as (keyof typeof expected)[]) {
    it(`refuses ${field} mismatch without exposing values`, () => {
      const value = field === "dirty" ? true : "private-mismatch-value";
      expect(() => validateBuildReceipt({ ...receipt, [field]: value }, expected)).toThrow(`build receipt mismatch: ${field}`);
    });
  }
  for (const field of Object.keys(receipt)) {
    it(`refuses missing ${field}`, () => {
      const partial: Record<string, unknown> = { ...receipt }; delete partial[field];
      expect(() => validateBuildReceipt(partial, expected)).toThrow(`build receipt mismatch: ${field}`);
    });
  }
  it.each([null, [], "receipt", 0])("refuses malformed receipt %j", value => {
    expect(() => validateBuildReceipt(value, expected)).toThrow("build receipt mismatch: receipt");
  });
  it("validates timestamp syntax rather than comparing build time to current time", () => {
    expect(() => validateBuildReceipt({ ...receipt, builtAt: "invalid" }, expected)).toThrow("builtAt");
    expect(validateBuildReceipt({ ...receipt, builtAt: "2026-09-08T12:00:00.000Z" }, expected).builtAt).toContain("2026-09-08");
  });
  it.each(["", "../other", "abc/def", "abc?x", "abc\n"])("refuses unsafe BUILD_ID even when file agrees: %j", buildId => {
    expect(() => validateBuildReceipt({ ...receipt, buildId }, { ...expected, buildId })).toThrow("buildId");
  });
});

describe("public config digest", () => {
  it("is order independent, excludes non-public keys, and stores no values", () => {
    const first = publicConfigDigest({ NEXT_PUBLIC_A: "public-value-alpha", NEXT_PUBLIC_B: "public-value-beta", AUTH_PIN_PEPPER: "private-value" });
    expect(first).toBe(publicConfigDigest({ NEXT_PUBLIC_B: "public-value-beta", NEXT_PUBLIC_A: "public-value-alpha", AUTH_PIN_PEPPER: "changed-private", SIM_PHASE: "runtime" }));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    for (const value of ["public-value-alpha", "public-value-beta", "private-value", "NEXT_PUBLIC_A"]) expect(first).not.toContain(value);
  });
  it("detects public value, key and absence changes; preserves empty values", () => {
    const original = publicConfigDigest({ NEXT_PUBLIC_A: "a" });
    for (const env of [{ NEXT_PUBLIC_A: "b" }, { NEXT_PUBLIC_B: "a" }, {}, { NEXT_PUBLIC_A: "" }]) expect(publicConfigDigest(env)).not.toBe(original);
    expect(publicConfigDigest({ NEXT_PUBLIC_A: undefined })).toBe(publicConfigDigest({}));
    expect(publicConfigDigest({ NEXT_PUBLIC_A: "" })).not.toBe(publicConfigDigest({}));
  });
});

describe("BUILD_ID HTML asset paths", () => {
  it("parses local relative and absolute script/link assets with either quote style", () => {
    expect(buildAssetsFromHtml(`<script src="/_next/static/build_1-x/_buildManifest.js"></script><link href='http://localhost:3100/_next/static/build_1-x/chunk.js?x=1&amp;y=2'>`)).toEqual([
      { buildId: "build_1-x", path: "/_next/static/build_1-x/_buildManifest.js" },
      { buildId: "build_1-x", path: "/_next/static/build_1-x/chunk.js" },
    ]);
  });
  it("does not mistake hashed chunks, foreign hosts, text or query values for BUILD_ID assets", () => {
    expect(buildAssetsFromHtml(`<script src="/_next/static/chunks/hash.js"></script><link href="/_next/static/css/hash.css"><img src="/_next/static/media/font.woff2"><script src="/_next/static/development/_buildManifest.js"></script><script src="https://foreign.invalid/_next/static/id/chunk.js"></script><script src="//localhost:3100/_next/static/id/chunk.js"></script><script src="http://user@localhost:3100/_next/static/id/chunk.js"></script><script src="/else?path=/_next/static/id/chunk.js"></script><p>/_next/static/id/chunk.js</p>`)).toEqual([]);
  });
  it("retains foreign build IDs so callers can refuse mixed HTML", () => {
    expect(buildAssetsFromHtml(`<script src="/_next/static/old/a.js"></script><script src="/_next/static/current/b.js"></script>`).map(asset => asset.buildId)).toEqual(["old", "current"]);
  });
});
