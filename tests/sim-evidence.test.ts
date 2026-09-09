import { describe, it, expect, vi } from "vitest";
import PublicProjectionReporter, { Evidence, MASK_SELECTORS, newManifest, projectNetwork } from "../scripts/sim/launch-readiness/evidence";

describe("sim evidence", () => {
  it("has the current manifest identity, provenance and outcome fields", () => {
    const manifest = newManifest("unit", "cold-empty");
    for (const key of ["runId", "candidateSha", "dirty", "dependencyLockHash", "policyVersion", "buildId", "fixture", "personas", "etAnchor", "startedAt", "finishedAt", "tests", "status", "reason", "deniedDestinations", "identity", "artifacts", "reviewerProvenance"]) expect(manifest).toHaveProperty(key);
    expect(manifest.fixture.restore).toBe("stub");
    expect(manifest.identity.server).toBe(false);
    expect(manifest.reviewerProvenance).toBe("unverified");
  });
  it("masks password, real PIN keypad, numeric PIN fallback and sensitive surfaces", () => {
    expect(MASK_SELECTORS).toContain('input[type="password"]');
    expect(MASK_SELECTORS).toContain('input[inputmode="numeric"]');
    expect(MASK_SELECTORS).toContain('[aria-label*="PIN"]');
    expect(MASK_SELECTORS).toContain('[data-sensitive]');
  });
  it("projects only closed fields, with no query, credentials, arbitrary paths or headers", () => {
    const canary = "canary-secret-contact";
    for (const raw of [`https://example.invalid/${canary}?token=${canary}`, `http://localhost:3100/api/auth/pin?pin=${canary}`, `http://localhost:3100/${encodeURIComponent(canary)}`, `http://user:${canary}@localhost:3100/?nested=${encodeURIComponent(JSON.stringify({ Authorization: canary }))}`]) {
      const row = projectNetwork("GET", raw, 200, 3.5);
      expect(Object.keys(row).sort()).toEqual(["category", "method", "route", "status", "timing"]);
      expect(JSON.stringify(row)).not.toContain(canary);
      expect(JSON.stringify(row)).not.toMatch(/\?|Authorization|Cookie|headers|body/);
    }
  });
  it("finalize fails on zero-byte or missing artifacts even after a passing test", () => {
    for (const read of [() => new Uint8Array(), () => { throw new Error("missing"); }]) {
      const evidence = new Evidence("unit", "cold-empty");
      const write = vi.spyOn(evidence, "write").mockImplementation(() => {});
      evidence.manifest.status = "pass";
      expect(evidence.finalize(["results.json"], read).status).toBe("fail");
      expect(write).toHaveBeenCalledWith("manifest.json", evidence.manifest);
    }
  });
  it("never publishes a private artifact reference", () => {
    const evidence = new Evidence("unit", "cold-empty");
    vi.spyOn(evidence, "write").mockImplementation(() => {});
    expect(evidence.finalize(["../.private/trace.zip"], () => new Uint8Array([1])).status).toBe("fail");
    expect(evidence.manifest.artifacts).toEqual([]);
  });
  it("strips private traces, credential steps and raw failures before stock reporters", () => {
    const reporter = new PublicProjectionReporter();
    const result = {
      attachments: [{ name: "trace", path: ".private/canary-secret/trace.zip" }],
      stdout: ["canary-secret"], stderr: ["canary-secret"], steps: [{ title: "type canary-secret" }],
      errors: [{ message: "canary-secret", snippet: "canary-secret" }], error: { message: "canary-secret" },
    } as unknown as Parameters<PublicProjectionReporter["onTestEnd"]>[1];
    reporter.onTestEnd({} as Parameters<PublicProjectionReporter["onTestEnd"]>[0], result);
    expect(JSON.stringify(result)).not.toContain("canary-secret");
    expect(JSON.stringify(result)).not.toContain(".private");
    expect(result.attachments).toEqual([]);
    const error = { message: "canary-secret", value: "canary-secret", stack: "canary-secret" };
    reporter.onError(error);
    expect(JSON.stringify(error)).not.toContain("canary-secret");
  });
});
