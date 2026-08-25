/**
 * Unit spine — THE PAR-WRITE AUTHORITY's pure half (Dynamic Pars Phase 3, Task 3.8).
 *
 * The write itself is I/O and lives in lib/dynamic-pars.ts. The DECISION — what a par
 * write does to the human lane, the machine lane, the baseline, the applied stamp, the
 * PIN and the weekly budget — is pure, and it is pinned here against the exact effect
 * table in the plan (Task 3.8), row by row.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. r3 found that "accept" was a privilege escalation
 * waiting to happen and that the admin overlay route must be structurally incapable of
 * writing the machine's lane. Both of those are properties of this table, so both are
 * asserted here rather than described in a comment.
 */
import { describe, it, expect } from "vitest";

import {
  PAR_WRITE_MIN,
  parActionEffects,
  parWriteColumns,
  type DayClass,
  type ParWriteActorKind,
} from "@/lib/dynamic-pars-shared";
import { getRoleLevel } from "@/lib/roles";

const KINDS: ParWriteActorKind[] = ["admin", "accept", "revert", "machine"];
const DAY_CLASSES: DayClass[] = ["weekday", "weekend"];
const AT = "2026-08-22T04:00:00.000Z";

describe("PAR_WRITE_MIN — plan D1: the floor is GM, and GM is 7", () => {
  it("is exactly the level lib/roles.ts gives `gm`", () => {
    // r3 said "GM >= 6". Live, level 6 is agm / catering_mgr / prep_mgr / social_media_mgr —
    // so the r3 spelling would have handed par-write to the Social Media Manager. The floor
    // is pinned to the ROLE, not to the number, so a future renumber fails here loudly.
    expect(PAR_WRITE_MIN).toBe(getRoleLevel("gm"));
  });

  it("is strictly above every level-6 role", () => {
    for (const role of ["agm", "catering_mgr", "prep_mgr", "social_media_mgr"] as const) {
      expect(getRoleLevel(role)).toBeLessThan(PAR_WRITE_MIN);
    }
  });
});

describe("parActionEffects — the three human verbs", () => {
  it("ACCEPT writes the par, clears the pin, and is FREE", () => {
    // r2-8: the incentive must never punish engagement.
    expect(parActionEffects("accept")).toEqual({
      writesPar: true, setsPin: false, clearsPin: true, consumesBudget: false,
    });
  });

  it("REVERT writes the par back, SETS the pin, and DOES consume the budget", () => {
    // r2-8 final form: a revert is a non-manual-origin par write, and the budget is what
    // stops a revert war. The act that sets a pin never clears it (r3).
    expect(parActionEffects("revert")).toEqual({
      writesPar: true, setsPin: true, clearsPin: false, consumesBudget: true,
    });
  });

  it("DISMISS changes nothing at all — it exists for the ramp's denominator", () => {
    expect(parActionEffects("dismiss")).toEqual({
      writesPar: false, setsPin: false, clearsPin: false, consumesBudget: false,
    });
  });

  it("no verb both sets and clears the pin", () => {
    for (const a of ["accept", "dismiss", "revert"] as const) {
      const e = parActionEffects(a);
      expect(e.setsPin && e.clearsPin).toBe(false);
    }
  });
});

describe("parWriteColumns — the machine-lane bypass is STRUCTURAL", () => {
  it("an `admin` write NEVER produces a non-null auto value", () => {
    // THE r3 GUARD, as a property rather than a promise: whatever an operator submits to
    // the admin overlay route, the columns this authority emits for them can only ever
    // NULL the machine's lane. There is no input that makes it write one.
    for (const dayClass of DAY_CLASSES) {
      for (const value of [null, 0, 4, 12.25]) {
        const cols = parWriteColumns({ kind: "admin", dayClass, value, autoValue: 99, baselinePar: 99, appliedAt: AT });
        for (const v of Object.values(cols.autoLane)) expect(v).toBeNull();
      }
    }
  });

  it("the human patch never names a machine column, and vice versa", () => {
    for (const kind of KINDS) {
      for (const dayClass of DAY_CLASSES) {
        const cols = parWriteColumns({ kind, dayClass, value: 4, autoValue: 4, baselinePar: 3, appliedAt: AT });
        for (const k of Object.keys(cols.human)) {
          expect(k.startsWith("auto_")).toBe(false);
          expect(k.startsWith("pinned_")).toBe(false);
        }
        for (const k of Object.keys(cols.autoLane)) {
          expect(k === "weekday_par" || k === "weekend_par").toBe(false);
        }
      }
    }
  });

  it("SPLIT SO PRE-0183 IS SAFE: the human patch alone is a legal write today", () => {
    // The autoLane half names columns migration 0183 adds. The server writes it only when
    // the probe is true; the human half is the exact column set that exists on main.
    const cols = parWriteColumns({ kind: "accept", dayClass: "weekday", value: 4 });
    expect(Object.keys(cols.human)).toEqual(["weekday_par"]);
  });

  it("`machine` NEVER touches the human lane or the pin", () => {
    for (const dayClass of DAY_CLASSES) {
      const cols = parWriteColumns({
        kind: "machine", dayClass, value: 99, autoValue: 4, baselinePar: 3, appliedAt: AT,
      });
      expect(cols.human).toEqual({});
      expect(Object.keys(cols.autoLane)).not.toContain(`pinned_${dayClass}_at`);
    }
  });

  it("`machine` writes value, baseline and stamp together on ITS OWN slot", () => {
    const cols = parWriteColumns({
      kind: "machine", dayClass: "weekend", value: null, autoValue: 6, baselinePar: 5, appliedAt: AT,
    });
    expect(cols.autoLane).toEqual({
      auto_weekend_par: 6,
      auto_weekend_baseline_par: 5,
      auto_weekend_applied_at: AT,
    });
    // PER-SLOT, NOT PER-ROW (aggie r3): a weekend move may not stamp the weekday slot.
    expect(Object.keys(cols.autoLane).some((k) => k.includes("weekday"))).toBe(false);
  });

  it("THROWS on a revert with no appliedAt — loud beats silent (LEAD RULING F4)", () => {
    // The pure core may not read the clock (this module promises "PURE: zero I/O"), and the
    // silent alternative is worse than the throw: `?? null` would DROP THE PIN on a caller
    // that forgot the stamp, on the one column whose whole job is to stand until a human
    // clears it. A missing stamp is a caller bug, so it fails at the caller.
    for (const appliedAt of [undefined, null]) {
      expect(() =>
        parWriteColumns({ kind: "revert", dayClass: "weekday", value: 3, appliedAt }),
      ).toThrow("parWriteColumns: revert requires appliedAt");
    }
  });

  it("a revert pins to EXACTLY the stamp it was handed — no clock, no drift", () => {
    for (const dayClass of DAY_CLASSES) {
      const cols = parWriteColumns({ kind: "revert", dayClass, value: 3, appliedAt: AT });
      expect(cols.autoLane[`pinned_${dayClass}_at`]).toBe(AT);
    }
  });

  it("the OTHER kinds never require appliedAt — only a revert sets a pin", () => {
    for (const kind of ["admin", "accept"] as const) {
      expect(() => parWriteColumns({ kind, dayClass: "weekday", value: 3 })).not.toThrow();
    }
    expect(() =>
      parWriteColumns({ kind: "machine", dayClass: "weekday", value: null, autoValue: 4 }),
    ).not.toThrow();
  });

  it("is DETERMINISTIC: the same input gives the same output, twice", () => {
    const input = { kind: "revert" as const, dayClass: "weekday" as const, value: 3, appliedAt: AT };
    expect(parWriteColumns(input)).toEqual(parWriteColumns(input));
  });

  it("`admin` and `accept` clear the pin; `revert` sets it", () => {
    const admin = parWriteColumns({ kind: "admin", dayClass: "weekday", value: 4 });
    const accept = parWriteColumns({ kind: "accept", dayClass: "weekday", value: 4 });
    const revert = parWriteColumns({ kind: "revert", dayClass: "weekday", value: 3, appliedAt: AT });
    expect(admin.autoLane.pinned_weekday_at).toBeNull();
    expect(accept.autoLane.pinned_weekday_at).toBeNull();
    expect(revert.autoLane.pinned_weekday_at).toBe(AT);
  });

  it("`admin` blank-to-global nulls the human lane AND the machine's number", () => {
    // r3: blanking your own override must not resurrect a stale machine number the human
    // never saw. Both lanes go, on this slot only.
    const cols = parWriteColumns({ kind: "admin", dayClass: "weekend", value: null });
    expect(cols.human).toEqual({ weekend_par: null });
    expect(cols.autoLane).toEqual({
      auto_weekend_par: null,
      auto_weekend_baseline_par: null,
      auto_weekend_applied_at: null,
      pinned_weekend_at: null,
    });
  });

  it("every human write invalidates the machine's standing opinion on that slot", () => {
    // admin / accept / revert all move the par; a machine value computed against the old
    // one is stale by construction, so all three null it.
    for (const kind of ["admin", "accept", "revert"] as const) {
      const cols = parWriteColumns({ kind, dayClass: "weekday", value: 5, appliedAt: AT });
      expect(cols.autoLane.auto_weekday_par).toBeNull();
      expect(cols.autoLane.auto_weekday_baseline_par).toBeNull();
      expect(cols.autoLane.auto_weekday_applied_at).toBeNull();
    }
  });
});
