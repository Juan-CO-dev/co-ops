import { describe, expect, it } from "vitest";
import { isStepUpSurface } from "@/lib/session";

describe("catering transfer unlock survives only the mutation endpoint", () => {
  it("preserves the password unlock for transfer", () => {
    expect(isStepUpSurface("/api/catering/pipeline/lead-id/transfer")).toBe(true);
  });
  it.each([
    "/catering/pipeline", "/api/catering/pipeline", "/api/catering/pipeline/lead-id",
    "/api/catering/pipeline/lead-id/transfer/extra", "/api/catering/pipeline/nested/lead-id/transfer",
    "/api/catering/pipeline//transfer", "/api/catering/pipeline/lead-id/transfer-fake",
  ])("clears it on %s", (path) => { expect(isStepUpSurface(path)).toBe(false); });
});
