import { readFileSync } from "node:fs";
import { mapChecklistError } from "../app/api/checklist/_helpers";
import { ChecklistError } from "../lib/checklists";
import en from "../lib/i18n/en.json";
import es from "../lib/i18n/es.json";
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
  it("preserves policy OR and the three intentional tightenings: submission, confirm and active membership", () => {
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
        expect(c.status !== "open" || !c.membershipActive).toBe(true);
        expect(c.expected.confirm).toBe(false);
      }
      if (c.expected.completion !== c.expected.liveCompletion && c.role !== "unknown_role") {
        expect(c.membershipActive).toBe(false);
        expect(c.expected.completion).toBe(false);
      }
      if (c.expected.instanceCreate !== c.expected.liveInstanceCreate) {
        expect(c.membershipActive).toBe(false);
        expect(c.expected.instanceCreate).toBe(false);
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

describe("correction error and route guard contract", () => {
  it.each(["instance_not_open", "reference_row_not_correctable", "prep_data_not_correctable", "tag_changed"])("maps and translates %s", async code => {
    const response = mapChecklistError(new ChecklistError(code, code));
    expect(response.status).toBe(["instance_not_open", "tag_changed"].includes(code) ? 409 : 400);
    expect(await response.json()).toMatchObject({ code });
    const key = `closing.error.${code}` as keyof typeof en;
    expect(en[key]).toBeTruthy(); expect(es[key]).toBeTruthy(); expect(es[key]).not.toBe(en[key]);
    const component = readFileSync("components/ChecklistItem.tsx", "utf8");
    expect(component).toContain(`case "${code}":`);
    expect(component).toContain(`t("${key}")`);
  });
  it.each(["revoke", "revoke-with-reason", "mark-not-done", "tag-actual-completer"])("%s retains origin guard before params/auth/body and resolves actor", name => {
    const source = readFileSync(`app/api/checklist/completions/[id]/${name}/route.ts`, "utf8");
    const body = source.slice(source.indexOf("export async function POST"));
    expect(body.indexOf("assertSameOrigin(req)")).toBeLessThan(body.indexOf("await params"));
    expect(body).toContain("actor: await resolveChecklistWriteActor(ctx)");
    expect(body).not.toContain("actor: { userId:");
  });
});
