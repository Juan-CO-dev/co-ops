import { describe, expect, it } from "vitest";
import { getRoleLevel, type RoleCode } from "../lib/roles";
import { canWriteChecklistCompletion, canSubmitChecklistBatch,
  canConfirmChecklistInstance, canCreateChecklistInstance } from "../lib/checklist-write-guard-shared";
import { CHECKLIST_PARITY_CASES, PARITY_ROLES, actorForParityCase,
  contextForParityCase } from "./fixtures/checklist-write-parity.mjs";

describe("R7 shared authorization case table", () => {
  it("pins the live role map against the application's single registry", () => {
    for (const [role, level] of Object.entries(PARITY_ROLES)) {
      expect(getRoleLevel(role as RoleCode), role).toBe(level);
    }
  });
  it("preserves policy OR, member-only writes and the two documented hole closures", () => {
    for (const c of CHECKLIST_PARITY_CASES) {
      const actor = actorForParityCase(c);
      const target = contextForParityCase(c);
      expect(canWriteChecklistCompletion(actor, target), `${c.id}: completion`).toBe(c.expected.completion);
      expect(canSubmitChecklistBatch(actor, target), `${c.id}: submission`).toBe(c.expected.submission);
      expect(canConfirmChecklistInstance(actor, target), `${c.id}: confirm`).toBe(c.expected.confirm);
      expect(canCreateChecklistInstance(actor, target), `${c.id}: create`).toBe(c.expected.instanceCreate);
      if (c.expected.submission !== c.expected.liveSubmission) {
        expect(c.expected.submission).toBe(false); // closure only, never a new allowance
      }
      if (c.expected.confirm !== c.expected.liveInstanceUpdate) {
        expect(c.status).not.toBe("open"); // no arbitrary status/column updates
        expect(c.expected.confirm).toBe(false);
      }
    }
  });
  it("does not silently fold stricter item checks into the baseline policy", () => {
    const actor = { userId: "actor", level: 3, active: true, locations: ["location"] };
    expect(canWriteChecklistCompletion(actor, { locationId: "location", status: "open",
      templateType: "closing", itemMinRoleLevel: 3, itemActive: false,
      itemMatchesTemplate: false, reportReferenceType: "cash_report",
      refTrackItemCompletion: true, referencesTemplateItemId: "ref" })).toBe(true);
  });
});
