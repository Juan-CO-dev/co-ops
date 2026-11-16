import { readFileSync } from "node:fs";
import { mapChecklistError } from "../app/api/checklist/_helpers";
import { ChecklistError } from "../lib/checklists";
import en from "../lib/i18n/en.json";
import es from "../lib/i18n/es.json";
import { describe, expect, it } from "vitest";
import { getRoleLevel, type RoleCode } from "../lib/roles";
import { canWriteChecklistCompletion, canSubmitChecklistBatch,
  canConfirmChecklistInstance, canCreateChecklistInstance, isSystemTrackedItem } from "../lib/checklist-write-guard-shared";
import { canCompleteChecklistItem } from "../lib/checklist-constants";
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
  it.each(["instance_not_open", "reference_row_not_correctable", "prep_data_not_correctable", "tag_changed", "checklist_corrections_unavailable"])("maps and translates %s", async code => {
    const response = mapChecklistError(new ChecklistError(code, code));
    expect(response.status).toBe(code === "checklist_corrections_unavailable" ? 503 : ["instance_not_open", "tag_changed"].includes(code) ? 409 : 400);
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

/**
 * Audit W14 / B182 — an item-tracking tick (a closing line that follows another item) is written
 * by the system, like a report reference. A generic correction could revoke it, and then nothing
 * could tick it again: the reconciler never re-ticks over a revoke and a manual tick is refused,
 * so a hard-gated closing could never be confirmed. Corrections now refuse it everywhere:
 * the three SQL writers (migration 0315), tagging (lib/checklists.ts), and the row's controls.
 */
describe("isSystemTrackedItem — lines the system completes take no generic correction (B182)", () => {
  it("a report reference and an item-tracking line are system rows; an ordinary line is not", () => {
    expect(isSystemTrackedItem({ reportReferenceType: "cash_report", refTrackItemCompletion: false, referencesTemplateItemId: null })).toBe(true);
    expect(isSystemTrackedItem({ reportReferenceType: null, refTrackItemCompletion: true, referencesTemplateItemId: "opening-item" })).toBe(true);
    expect(isSystemTrackedItem({ reportReferenceType: null, refTrackItemCompletion: false, referencesTemplateItemId: null })).toBe(false);
  });
  it("the tracking flag with no referenced item, or a reference with no flag, is an ordinary line (the SQL rule exactly)", () => {
    expect(isSystemTrackedItem({ reportReferenceType: null, refTrackItemCompletion: true, referencesTemplateItemId: null })).toBe(false);
    expect(isSystemTrackedItem({ reportReferenceType: null, refTrackItemCompletion: false, referencesTemplateItemId: "opening-item" })).toBe(false);
    expect(isSystemTrackedItem({ reportReferenceType: null })).toBe(false);
  });
  it("is exactly the set of lines nobody may tick by hand", () => {
    for (const reportReferenceType of [null, "am_prep"]) for (const refTrackItemCompletion of [false, true]) for (const referencesTemplateItemId of [null, "x"]) {
      const item = { reportReferenceType, refTrackItemCompletion, referencesTemplateItemId };
      expect(isSystemTrackedItem(item), JSON.stringify(item))
        .toBe(!canCompleteChecklistItem({ templateType: "closing", actorLevel: 10, itemMinRoleLevel: 0, ...item }));
    }
  });
  it("tagging refuses a system row with the existing code, before any window or authority check", () => {
    const src = readFileSync("lib/checklists.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function tagActualCompleter("), src.indexOf("// Authorization: KH+ OR self.", src.indexOf("export async function tagActualCompleter(")));
    const refusal = fn.indexOf('if (isSystemTrackedItem({ reportReferenceType: item.report_reference_type, refTrackItemCompletion: item.ref_track_item_completion, referencesTemplateItemId: item.references_template_item_id }))');
    expect(refusal).toBeGreaterThan(-1);
    expect(fn.slice(refusal, refusal + 420)).toContain('"reference_row_not_correctable"');
    expect(refusal).toBeLessThan(fn.indexOf("elapsedSinceCompleted("));
    expect(fn).not.toContain("if (item.report_reference_type) throw");
  });
  it("the closing row offers no Undo, tag or mark-not-done on a line nobody may tick by hand", () => {
    const row = readFileSync("components/ChecklistItem.tsx", "utf8");
    // roleGated is true for a system row (canCompleteChecklistItem gets the ref-track fields) …
    expect(row).toContain("const roleGated = !canCompleteChecklistItem({ templateType, actorLevel, itemMinRoleLevel: templateItem.minRoleLevel, reportReferenceType: templateItem.reportReferenceType, refTrackItemCompletion: templateItem.refTrackItemCompletion, referencesTemplateItemId: templateItem.referencesTemplateItemId });");
    expect(row).toContain("const interactable = !roleGated && !instanceLocked && !readOnly && !inFlight;");
    // … and every correction affordance requires an interactable row.
    for (const flag of ["showUndo", "showTagAffordance", "showMarkNotDone"]) {
      const at = row.indexOf(`const ${flag} =`);
      expect(at, flag).toBeGreaterThan(-1);
      expect(row.slice(at, row.indexOf(";", at)), flag).toContain("interactable &&");
    }
  });
});
