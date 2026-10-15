import { describe, expect, it } from "vitest";
import { submitOutcome } from "@/lib/receiving-submit-shared";

describe("receiving submit outcomes", () => {
  it("clears busy and retains the entry for a refusal", () => {
    expect(submitOutcome({ type: "refused", message: "Duplicate" }, { busy: true })).toEqual({ busy: false, retryable: true, error: "Duplicate" });
  });
  it("clears busy and retains the entry for a thrown network/JSON error", () => {
    expect(submitOutcome({ type: "thrown", message: "Network" }, { busy: true })).toEqual({ busy: false, retryable: true, error: "Network" });
  });
  it("success clears the entry only after server acknowledgement", () => {
    expect(submitOutcome({ type: "ok" }, { busy: true })).toEqual({ busy: false, retryable: false, error: null });
  });
});
