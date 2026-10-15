import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initialReceivingSubmit, submitOutcome, submitStart } from "@/lib/receiving-submit-shared";

describe("receiving submit outcomes", () => {
  it("clears busy and retains the entry for a refusal", () => {
    expect(submitOutcome({ type: "refused", message: "Duplicate" }, submitStart(initialReceivingSubmit))).toEqual({ busy: false, retryable: true, error: "Duplicate" });
  });
  it("clears busy and retains the entry for a thrown network/JSON error", () => {
    expect(submitOutcome({ type: "thrown", message: "Network" }, submitStart(initialReceivingSubmit))).toEqual({ busy: false, retryable: true, error: "Network" });
  });
  it("success clears the entry only after server acknowledgement", () => {
    expect(submitOutcome({ type: "ok" }, submitStart(initialReceivingSubmit))).toEqual(initialReceivingSubmit);
  });
  it("drives the form's busy gate, refusal, thrown error, success and retry through the model", () => {
    const source = readFileSync("components/receiving/ReceivingForm.tsx", "utf8");
    expect(source).toContain("const busy = submitState.busy");
    expect(source).toContain("setSubmitState((s) => submitStart(s))");
    for (const outcome of ['type: "refused"', 'type: "thrown"', 'type: "ok"']) {
      expect(source).toContain(`submitOutcome({ ${outcome}`);
    }
    expect(source).toContain("submitState.retryable && retryStatus && canSubmit");
    expect(source).toContain("if (!canSubmit || submitBusyRef.current) return");
    expect(source).toContain("submitBusyRef.current = false");
  });
});
