/**
 * D-13 (Juan, 2026-10-13, option b) — the "Uses: …" consumption panel on prep rows is
 * read-only and collapsed for crew (level < 4) and editable for Key Holder (4) and up, and the
 * prep saves enforce the same floor server-side (the UI hiding is not the gate).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CONSUMPTION_EDIT_MIN, canEditConsumption, consumptionOverrideFor } from "@/lib/consumption-edit-shared";
import { ROLES } from "@/lib/roles";

const read = (p: string) => readFileSync(p, "utf8");
const edited = [{ skuId: "s1", qtyOz: 12, qtyEntered: 1, unitEntered: "case", derivedOz: 10 }];

describe("CONSUMPTION_EDIT_MIN", () => {
  it("is 4 — Key Holder", () => {
    expect(CONSUMPTION_EDIT_MIN).toBe(4);
    expect(CONSUMPTION_EDIT_MIN).toBe(ROLES.key_holder.level);
  });

  it("crew (Trainee, Employee) cannot edit; KH and up can", () => {
    expect(canEditConsumption(ROLES.trainee.level)).toBe(false);
    expect(canEditConsumption(ROLES.employee.level)).toBe(false);
    expect(canEditConsumption(ROLES.key_holder.level)).toBe(true);
    expect(canEditConsumption(ROLES.shift_lead.level)).toBe(true);
    expect(canEditConsumption(ROLES.gm.level)).toBe(true);
    expect(canEditConsumption(Number.NaN)).toBe(false);
  });
});

describe("consumptionOverrideFor", () => {
  it("drops a crew override to null (= record the derived default)", () => {
    expect(consumptionOverrideFor(3, edited)).toBeNull();
    expect(consumptionOverrideFor(2, edited)).toBeNull();
  });
  it("passes a KH+ override through; absent stays null", () => {
    expect(consumptionOverrideFor(4, edited)).toBe(edited);
    expect(consumptionOverrideFor(7, null)).toBeNull();
    expect(consumptionOverrideFor(7, undefined)).toBeNull();
  });
});

describe("server enforcement in both prep saves", () => {
  for (const [file, fn] of [
    ["lib/opening.ts", "export async function savePhase2Item("],
    ["lib/prep.ts", "export async function saveMidDayPhase2Item("],
  ] as const) {
    it(`${file} routes the client's confirmed set through consumptionOverrideFor`, () => {
      const src = read(file);
      const at = src.indexOf(fn);
      expect(at).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf("\nexport ", at + fn.length));
      expect(body).toContain("consumptionOverrideFor(args.actor.level, args.confirmedConsumption)");
      // every other read of the request's set is gone
      expect(body.match(/args\.confirmedConsumption/g)?.length).toBe(1);
    });
  }
});

describe("the panel and its callers", () => {
  const panel = read("components/production/ProductionConsumptionPanel.tsx");

  it("canEdit is a required prop, and false renders no button / no toggle", () => {
    expect(panel).toMatch(/canEdit: boolean;/);
    const ro = panel.slice(panel.indexOf("if (!canEdit) {"), panel.indexOf("  return (\n    <div", panel.indexOf("if (!canEdit) {")));
    expect(ro.length).toBeGreaterThan(0);
    expect(ro).not.toMatch(/<button|<input|onClick|setExpanded/);
    expect(ro).toContain('t("production.panel.uses")');
  });

  it("both Phase 2 pages derive the flag server-side from the session level", () => {
    expect(read("app/(authed)/operations/mid-day/page.tsx")).toContain("canEditConsumption={canEditConsumption(auth.level)}");
    expect(read("app/(authed)/operations/opening/page.tsx")).toContain("canEditConsumption={canEditConsumption(auth.level)}");
  });

  it("every panel render passes canEdit", () => {
    for (const f of ["components/MidDayPhase2Form.tsx", "components/opening/OpeningPrepEntry.tsx"]) {
      const src = read(f);
      const at = src.indexOf("<ProductionConsumptionPanel");
      expect(src.slice(at, src.indexOf("/>", at))).toContain("canEdit={canEditConsumption}");
    }
  });
});
