import { describe, expect, it } from "vitest";
import { initialMidDaySave, nextSaveStep } from "@/lib/mid-day-save-shared";

describe("mid-day per-item save ordering", () => {
  it("drops a same-signature duplicate even before React renders", () => {
    const first = nextSaveStep(initialMidDaySave, { type: "start", signature: "5" });
    expect(first.post).toBe(true);
    expect(nextSaveStep(first.state, { type: "start", signature: "5" }).post).toBe(false);
  });
  it("keeps a newer edit unsaved after the old request acknowledges", () => {
    const first = nextSaveStep(initialMidDaySave, { type: "start", signature: "5" });
    const edited = nextSaveStep(first.state, { type: "edit" });
    const blocked = nextSaveStep(edited.state, { type: "start", signature: "6" });
    expect(blocked.post).toBe(false);
    const acked = nextSaveStep(blocked.state, { type: "ack", revision: first.state.revision });
    expect(acked.state.phase).toBe("idle");
    expect(nextSaveStep(acked.state, { type: "start", signature: "6" }).post).toBe(true);
  });
  it("does not overwrite a new edit with an old refusal", () => {
    const first = nextSaveStep(initialMidDaySave, { type: "start", signature: "5" });
    const edited = nextSaveStep(first.state, { type: "edit" });
    expect(nextSaveStep(edited.state, { type: "fail", revision: first.state.revision }).state.phase).toBe("idle");
  });
});
