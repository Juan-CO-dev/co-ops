/**
 * Staff separations (Juan 2026-10-20; 0279) + GM user management — the PURE rules, every role.
 *
 *  - THE ROLE MATRIX for the reasons (Juan's decision): owner / MoO / CGS always; a GM only for a person who belongs to
 *    one of the GM's shops; every other role never — and the redacted view then carries no reason, no note, no date of
 *    the record beyond the chip.
 *  - User management's rule (`userAdminRefusal`) for every actor role × target role, and the GM shop scope.
 *  - The act rules (`employmentActRefusal`): transitions and the rehire authority, per role.
 *  - The state (`employmentStateOf`): status from the latest status event; corrections replace fields, newest wins.
 *  - The payload twin of 0279 (`parseEmploymentFields`), the phone normalizer (never a name), the scheduling roster
 *    (`toSchedPeople` drops the excluded), the reconciliation (on leave / separated listed with a chip, never missing).
 */
import { describe, expect, it } from "vitest";
import { ROLES, type RoleCode } from "@/lib/roles";
import {
  actStateOf, canSeeEmploymentDetail, employmentActRefusal, employmentChipKey, employmentStateOf, employmentViewFor, normalizePhone,
  parseEmploymentFields, type EmploymentEventRow,
} from "@/lib/admin/employment-shared";
import { userAdminListScope, userAdminRefusal } from "@/lib/admin/user-access-shared";
import { toSchedPeople } from "@/lib/scheduling/people-input-shared";
import { reconcile } from "@/lib/scheduling/reconcile-shared";
import { structure } from "./fixtures/schedule/fixtures";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALL_ROLES = Object.keys(ROLES) as RoleCode[];
const ev = (o: Partial<EmploymentEventRow> & Pick<EmploymentEventRow, "id" | "kind" | "createdAt">): EmploymentEventRow => ({
  userId: "u", correctsId: null, leaveReason: null, expectedBack: null, separationType: null, lastDayWorked: null, reason: null, rehire: null,
  rehireNote: null, note: null, actorId: "gm", ...o,
});
const SEPARATED = employmentStateOf([ev({ id: "s1", kind: "separated", createdAt: "2026-10-16T12:00:00Z", separationType: "fired", lastDayWorked: "2026-10-15",
  reason: "SECRET REASON", rehire: "no", rehireNote: "SECRET NOTE" })]);
const ON_LEAVE = employmentStateOf([ev({ id: "l1", kind: "leave_start", createdAt: "2026-10-16T12:00:00Z", leaveReason: "school", expectedBack: "2027-01-05", note: "SECRET LEAVE NOTE" })]);

describe("THE ROLE MATRIX — who reads the reasons (every role, in and out of the person's shop)", () => {
  const expected = (role: RoleCode, inShop: boolean) => role === "owner" || role === "moo" || role === "cgs" || (role === "gm" && inShop);
  for (const role of ALL_ROLES) {
    for (const inShop of [true, false]) {
      it(`${role} ${inShop ? "at" : "not at"} the person's shop → ${expected(role, inShop) ? "full record" : "chip only"}`, () => {
        const viewer = { role, locations: inShop ? [A] : [B] };
        expect(canSeeEmploymentDetail(viewer, [A])).toBe(expected(role, inShop));
        for (const state of [SEPARATED, ON_LEAVE]) {
          const view = employmentViewFor(viewer, [A], state);
          expect(view.chip).not.toBeNull();
          expect(view.status).toBe(state.status);
          if (expected(role, inShop)) expect(view.detail).toEqual(state.current);
          else {
            expect(view.detail).toBeNull();
            expect(JSON.stringify(view)).not.toMatch(/SECRET/);
          }
        }
      });
    }
  }
  it("a GM with no shop overlap never reads it, even for a two-shop person in another shop pair", () => {
    expect(canSeeEmploymentDetail({ role: "gm", locations: [] }, [A, B])).toBe(false);
    expect(canSeeEmploymentDetail({ role: "gm", locations: [B] }, [A, B])).toBe(true);
  });
  it("the chip words: on leave (until), separated × the three rehire settings — en and es", () => {
    for (const k of ["admin.users.employment.chip.on_leave", "admin.users.employment.chip.on_leave_until", "admin.users.employment.chip.separated_yes",
      "admin.users.employment.chip.separated_no", "admin.users.employment.chip.separated_only_with_owner_ok"] as const) {
      expect(en[k], k).toBeTruthy();
      expect(es[k], k).toBeTruthy();
    }
    expect(employmentChipKey({ status: "on_leave", until: null })).toBe("admin.users.employment.chip.on_leave");
    expect(employmentChipKey({ status: "on_leave", until: "2027-01-05" })).toBe("admin.users.employment.chip.on_leave_until");
    expect(employmentChipKey({ status: "separated", rehire: "only_with_owner_ok" })).toBe("admin.users.employment.chip.separated_only_with_owner_ok");
    expect(en["admin.users.employment.chip.separated_no"]).toBe("Separated · not eligible for rehire");
    expect(en["admin.users.employment.chip.separated_yes"]).toBe("Separated · rehire OK");
    expect(en["admin.users.employment.chip.separated_only_with_owner_ok"]).toBe("Separated · owner OK needed");
  });
  it("en / es parity for every new key; Spanish in tú (never usted / su)", () => {
    const mine = Object.keys(en).filter((k) => k.startsWith("admin.users.employment.") || k.startsWith("admin.users.rehire.") || k.startsWith("admin.users.group.")
      || ["admin.users.create.field.phone", "admin.users.create.field.phone_help", "admin.users.create.field.toast"].includes(k) || k.startsWith("admin.users.create.toast."));
    expect(mine.length).toBeGreaterThan(50);
    for (const k of mine) {
      const s = (es as Record<string, string>)[k];
      expect(s, k).toBeTruthy();
      expect(s, k).not.toMatch(/\busted\b|\bsu\b|\bsus\b/i);
    }
  });
});

describe("user management: GM own shop, strictly below; MoO+ unchanged", () => {
  const actor = (role: RoleCode, locations = [A]) => ({ userId: "actor", role, locations });
  it("every actor role × every target role at the actor's shop: below GM refused; otherwise strictly below", () => {
    for (const a of ALL_ROLES) for (const t of ALL_ROLES) {
      const r = userAdminRefusal(actor(a), { id: "t", role: t, locationIds: [A] });
      const ok = ROLES[a].level >= 7 && ROLES[a].level > ROLES[t].level;
      expect(r === null, `${a} → ${t}`).toBe(ok);
    }
  });
  it("a GM: never a person with a shop outside the GM's, never a person with no shop; MoO+ any shop", () => {
    expect(userAdminRefusal(actor("gm"), { id: "t", role: "employee", locationIds: [A, B] })).toBe("target_outside_shop");
    expect(userAdminRefusal(actor("gm"), { id: "t", role: "employee", locationIds: [B] })).toBe("target_outside_shop");
    expect(userAdminRefusal(actor("gm"), { id: "t", role: "employee", locationIds: [] })).toBe("target_outside_shop");
    expect(userAdminRefusal(actor("gm", [A, B]), { id: "t", role: "employee", locationIds: [A, B] })).toBeNull();
    expect(userAdminRefusal(actor("moo", []), { id: "t", role: "employee", locationIds: [B] })).toBeNull();
    expect(userAdminRefusal(actor("gm"), { id: "actor", role: "employee", locationIds: [A] })).toBe("forbidden");
    expect(userAdminListScope(actor("gm"))).toEqual([A]);
    expect(userAdminListScope(actor("moo"))).toBeNull();
  });
});

describe("the act rules: transitions and the rehire authority", () => {
  const a = (role: RoleCode) => ({ userId: "actor", role, locations: [A] });
  const emp = { id: "t", role: "employee" as RoleCode, locationIds: [A] };
  const rehireState = (rehire: "yes" | "no" | "only_with_owner_ok") => actStateOf(employmentStateOf([ev({ id: "s", kind: "separated", createdAt: "2026-10-16T12:00:00Z",
    separationType: "quit", lastDayWorked: "2026-10-15", reason: "r", rehire, rehireNote: rehire === "yes" ? null : "n" })]));
  it("transitions", () => {
    const active = actStateOf({ status: "active" });
    expect(employmentActRefusal(a("gm"), emp, "leave_start", active)).toBeNull();
    expect(employmentActRefusal(a("gm"), emp, "separated", active)).toBeNull();
    expect(employmentActRefusal(a("gm"), emp, "leave_end", active)).toBe("employment_invalid_transition");
    expect(employmentActRefusal(a("gm"), emp, "rehired", active)).toBe("employment_invalid_transition");
    expect(employmentActRefusal(a("gm"), emp, "correction", active)).toBe("employment_invalid_transition");
    expect(employmentActRefusal(a("gm"), emp, "separated", actStateOf(ON_LEAVE))).toBeNull();
    expect(employmentActRefusal(a("gm"), emp, "leave_start", actStateOf(ON_LEAVE))).toBe("employment_invalid_transition");
    expect(employmentActRefusal(a("gm"), emp, "separated", actStateOf(SEPARATED))).toBe("employment_invalid_transition");
    expect(employmentActRefusal(a("agm"), emp, "leave_start", active)).toBe("forbidden");
  });
  it.each([
    ["yes", { gm: true, moo: true, cgs: true, owner: true }],
    ["only_with_owner_ok", { gm: false, moo: true, cgs: true, owner: true }],
    // Juan 2026-10-20: the CGS holds the owner's authority for this feature.
    ["no", { gm: false, moo: false, cgs: true, owner: true }],
  ] as const)("rehire on %s", (setting, who) => {
    for (const [role, ok] of Object.entries(who) as Array<[RoleCode, boolean]>) {
      expect(employmentActRefusal(a(role), emp, "rehired", rehireState(setting)) === null, `${role} rehires on ${setting}`).toBe(ok);
    }
  });
  it("a correction may tighten freely, loosening needs the authority", () => {
    expect(employmentActRefusal(a("gm"), emp, "correction", rehireState("yes"), "no")).toBeNull();
    expect(employmentActRefusal(a("gm"), emp, "correction", rehireState("no"), "yes")).toBe("rehire_owner_required");
    expect(employmentActRefusal(a("gm"), emp, "correction", rehireState("only_with_owner_ok"), "yes")).toBe("rehire_owner_ok_required");
    expect(employmentActRefusal(a("moo"), emp, "correction", rehireState("only_with_owner_ok"), "yes")).toBeNull();
    expect(employmentActRefusal(a("owner"), emp, "correction", rehireState("no"), "yes")).toBeNull();
    expect(employmentActRefusal(a("cgs"), emp, "correction", rehireState("no"), "yes")).toBeNull();
    expect(employmentActRefusal(a("moo"), emp, "correction", rehireState("no"), "yes")).toBe("rehire_owner_required");
  });
  it("the act state reads the rehire setting from a REDACTED view too (the chip carries it)", () => {
    const view = employmentViewFor({ role: "agm", locations: [A] }, [A], SEPARATED);
    expect(view.detail).toBeNull();
    expect(actStateOf(view)).toEqual({ status: "separated", rehire: "no" });
  });
});

describe("the state: the latest status event; corrections replace the fields (newest wins)", () => {
  it("no events → active; leave → back → active; rehired → active; separated → separated", () => {
    expect(employmentStateOf([]).status).toBe("active");
    const back = employmentStateOf([ev({ id: "1", kind: "leave_start", createdAt: "2026-10-01T00:00:00Z", leaveReason: "seasonal" }), ev({ id: "2", kind: "leave_end", createdAt: "2026-10-02T00:00:00Z" })]);
    expect(back).toEqual({ status: "active", headId: "2", current: null });
    expect(SEPARATED.status).toBe("separated");
  });
  it("corrections: the newest correction of the event in force wins; the status never moves", () => {
    const s = employmentStateOf([
      ev({ id: "s", kind: "separated", createdAt: "2026-10-16T12:00:00Z", separationType: "fired", lastDayWorked: "2026-10-15", reason: "first", rehire: "no", rehireNote: "n" }),
      ev({ id: "c1", kind: "correction", correctsId: "s", createdAt: "2026-10-16T13:00:00Z", separationType: "quit", lastDayWorked: "2026-10-14", reason: "second", rehire: "no", rehireNote: "n" }),
      ev({ id: "c2", kind: "correction", correctsId: "s", createdAt: "2026-10-16T14:00:00Z", separationType: "quit", lastDayWorked: "2026-10-14", reason: "third", rehire: "yes" }),
    ]);
    expect(s.status).toBe("separated");
    expect(s.headId).toBe("c2");
    expect(s.current).toMatchObject({ kind: "separated", eventId: "s", reason: "third", rehire: "yes", corrected: true });
  });
});

describe("the payload (the twin of 0279's exact keys)", () => {
  it("leave", () => {
    expect(parseEmploymentFields("leave_start", { leaveReason: "school", expectedBack: "2027-01-05", note: "  x  " })).toEqual({ leaveReason: "school", expectedBack: "2027-01-05", note: "x" });
    expect(parseEmploymentFields("leave_start", { leaveReason: "vacation" })).toBeNull();
    expect(parseEmploymentFields("leave_start", { leaveReason: "school", expectedBack: "2027-02-30" })).toBeNull();
    expect(parseEmploymentFields("leave_start", { leaveReason: "school", why: "x" })).toBeNull();
  });
  it("separation", () => {
    const base = { separationType: "quit", lastDayWorked: "2026-10-15", reason: "r", rehire: "yes" };
    expect(parseEmploymentFields("separated", base)).toEqual({ ...base, rehireNote: null });
    expect(parseEmploymentFields("separated", { ...base, rehire: "yes", rehireNote: "dropped" })).toEqual({ ...base, rehireNote: null });
    expect(parseEmploymentFields("separated", { ...base, rehire: "no" })).toBeNull();
    expect(parseEmploymentFields("separated", { ...base, rehire: "only_with_owner_ok", rehireNote: " " })).toBeNull();
    expect(parseEmploymentFields("separated", { ...base, reason: "   " })).toBeNull();
    expect(parseEmploymentFields("separated", { ...base, reason: "x".repeat(2001) })).toBeNull();
    expect(parseEmploymentFields("separated", { ...base, separationType: "laid_off" })).toBeNull();
  });
  it("back from leave / rehire take only a note", () => {
    expect(parseEmploymentFields("leave_end", {})).toEqual({ note: null });
    expect(parseEmploymentFields("rehired", { note: "Owner said yes" })).toEqual({ note: "Owner said yes" });
    expect(parseEmploymentFields("rehired", { leaveReason: "school" })).toBeNull();
  });
});

describe("the rehire key is a phone (normalized) — never a name", () => {
  it.each([["(202) 555-0101", "2025550101"], ["+1 202 555 0101", "2025550101"], ["202.555.0101", "2025550101"], ["12025550101", "2025550101"],
    ["555-0101", null], ["", null], [null, null], ["Miguel Lopez", null], ["+44 20 7946 0958", null]] as const)("%s → %s", (raw, out) => {
    expect(normalizePhone(raw)).toBe(out);
  });
});

describe("scheduling: toSchedPeople drops on leave / separated people whatever else says", () => {
  it("an excluded member never reaches the roster (the role, the settings and roster_include notwithstanding)", () => {
    const s = structure();
    const members = [{ userId: "u1", role: "employee" as RoleCode, active: true }, { userId: "u2", role: "employee" as RoleCode, active: true }];
    const args = { members, settings: [{ userId: "u2", workType: "foh" as const, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null,
      fullTime: true, fullTimeMinH: null, rosterInclude: true }], patterns: {}, dates: ["2026-10-26"], structure: s, shopDay: { fromQ: 40, toQ: 90 },
      wages: { byUserCents: {}, estimateHourlyCents: 1840 }, skills: null };
    expect(toSchedPeople(args).people.map((p) => p.userId)).toEqual(["u1", "u2"]);
    expect(toSchedPeople({ ...args, excludedUserIds: ["u2"] }).people.map((p) => p.userId)).toEqual(["u1"]);
    expect(JSON.stringify(toSchedPeople({ ...args, excludedUserIds: [] }))).toBe(JSON.stringify(toSchedPeople(args)));
  });
});

describe("the reconciliation: on leave / separated people are listed with their chip, never as missing", () => {
  it("no identity flags for them, listed after the working people; a separated person clocking in is still a flag", () => {
    const out = reconcile({
      dates: ["2026-10-14"], sevenStatus: "ready", shopLinkedToSeven: true,
      members: [{ userId: "w", name: "Ana" }, { userId: "s", name: "Aaron", employment: { status: "separated", rehire: "no" } },
        { userId: "l", name: "Abe", employment: { status: "on_leave", until: "2027-01-05" } }],
      toastLinks: [{ employeeGuid: "tg-s", userId: "s" }], sevenLinks: [], sevenUsersAtShop: [],
      toastPunches14d: [{ employeeGuid: "tg-s", firstName: "Aaron", businessDate: "2026-10-14", inAt: "2026-10-14T14:00:00.000Z", outAt: "2026-10-14T18:00:00.000Z", hours: 4 }],
      sevenPunches14d: [], publishedSevenShifts14d: [], coopsProposalShifts14d: [], coopsProposalDates: ["2026-10-14"], now: "2026-10-20T12:00:00.000Z", sevenInactiveAtShop: 0,
    });
    expect(out.rows.map((r) => r.userId)).toEqual(["w", "s", "l"]);
    const l = out.rows.find((r) => r.userId === "l")!;
    expect(l.employment).toEqual({ status: "on_leave", until: "2027-01-05" });
    expect(l.flags).toEqual([]);
    const s = out.rows.find((r) => r.userId === "s")!;
    expect(s.flags.map((f) => f.code)).not.toContain("member_no_seven");
    expect(s.flags.map((f) => f.code)).toContain("proposal_differs");
    expect(out.rows.find((r) => r.userId === "w")!.employment).toBeNull();
  });
});
