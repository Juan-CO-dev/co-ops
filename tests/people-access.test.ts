import { describe, expect, it } from "vitest";

import lifecycle from "./fixtures/pm-copy-lifecycle-cases.json";
import {
  PM_COPY_TRANSITIONS,
  canAdjustSkill,
  canEditPeopleSettings,
  canEditPmCriteria,
  canEditSkillTunables,
  canLinkSevenShiftsUser,
  canManageSevenShiftsPeople,
  canManageSevenShiftsShops,
  canMarkDone,
  canRateNewHire,
  canReadPmCopy,
  canReopenPmCopy,
  canSeeShopLaborTotals,
  canSeeWageRates,
  canSubmitPmDay,
  canSyncNow,
  canViewPeople,
  canViewSevenShiftsStatus,
  canWritePmCopy,
  peopleActorFromAuth,
  pmCopyActRefusal,
  type PeopleActor,
  type PmCopyAct,
  type PmCopyStatus,
  type PmDayStatus,
} from "@/lib/people/access-shared";
import { ROLES, type RoleCode } from "@/lib/roles";

const OWN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type Where = "own" | "other" | "none";
const ALL_ROLES = Object.keys(ROLES) as RoleCode[];

function actor(role: RoleCode, where: Where = "own", userId = `u-${role}`): PeopleActor {
  return { userId, role, level: ROLES[role].level, locations: where === "none" ? [] : [OWN] };
}
/** The shop each case is asked about: own = a shop the actor holds; other/none = a shop they do not. */
function shopFor(where: Where): string {
  return where === "own" ? OWN : OTHER;
}

const OP6: RoleCode[] = ["agm", "catering_mgr", "prep_mgr"];
const MOO_PLUS: RoleCode[] = ["moo", "owner", "cgs"];

// ─── The expected matrix, written out per role (never derived from the code under test) ───
/** Team scoring / person detail / skills of others: Op-6 + GM own shop; MoO+ any; SMM never. */
function expectViewPeople(role: RoleCode, where: Where): boolean {
  if (MOO_PLUS.includes(role)) return true;
  if (role === "gm" || OP6.includes(role)) return where === "own";
  return false;
}
/** GM own shop, MoO+ any shop: skill adjust (subject aside), shop settings, criteria editor. */
function expectGmOwnMooAny(role: RoleCode, where: Where): boolean {
  if (MOO_PLUS.includes(role)) return true;
  return role === "gm" && where === "own";
}

describe("peopleActorFromAuth — the trusted role and level come from the verified session", () => {
  it("takes role from auth.role and level from auth.level, never from the user row or a body", () => {
    const auth = {
      user: { id: "user-1", role: "owner" as RoleCode, level: 9 },
      role: "agm" as RoleCode,
      level: 6,
      locations: [OWN],
      body: { role: "owner", level: 9, locations: [OTHER] },
    };
    const a = peopleActorFromAuth(auth);
    expect(a).toEqual({ userId: "user-1", role: "agm", level: 6, locations: [OWN] });
  });

  it("copies the location list, so a later mutation of the session array cannot widen the actor", () => {
    const locations = [OWN];
    const a = peopleActorFromAuth({ user: { id: "u" }, role: "gm", level: 7, locations });
    locations.push(OTHER);
    expect(a.locations).toEqual([OWN]);
  });
});

describe("canViewPeople — every role × {own, other, no shop}", () => {
  for (const role of ALL_ROLES) {
    for (const where of ["own", "other", "none"] as const) {
      const want = expectViewPeople(role, where);
      it(`${role} @ ${where} → ${want}`, () => {
        expect(canViewPeople(actor(role, where), shopFor(where))).toBe(want);
      });
    }
  }

  it("refuses the 'all' pseudo-location for everyone (one shop at a time)", () => {
    for (const role of ALL_ROLES) expect(canViewPeople(actor(role), "all")).toBe(false);
  });
});

describe("r1 P2-8 — the same level 6 and the same shop answer differently BY ROLE", () => {
  const level6: RoleCode[] = ["agm", "catering_mgr", "prep_mgr", "social_media_mgr"];
  it("all four are level 6", () => {
    for (const role of level6) expect(ROLES[role].level).toBe(6);
  });
  it.each(OP6)("%s is allowed team scoring at its own shop", (role) => {
    expect(canViewPeople(actor(role), OWN)).toBe(true);
  });
  it("social_media_mgr is refused at its own shop, another shop, and with no shop", () => {
    expect(canViewPeople(actor("social_media_mgr", "own"), OWN)).toBe(false);
    expect(canViewPeople(actor("social_media_mgr", "own"), OTHER)).toBe(false);
    expect(canViewPeople(actor("social_media_mgr", "none"), OWN)).toBe(false);
  });
  it("a social_media_mgr carrying a forged higher level is still refused by role", () => {
    // Defence in depth: the refusal is a ROLE check, so a level that disagrees with the role
    // (it never should — both come from the session) cannot open the door.
    const forged: PeopleActor = { userId: "x", role: "social_media_mgr", level: 9, locations: [OWN] };
    expect(canViewPeople(forged, OWN)).toBe(false);
    expect(canViewSevenShiftsStatus(forged, OWN)).toBe(false);
    expect(canSeeShopLaborTotals(forged, OWN)).toBe(false);
    expect(canSubmitPmDay(forged)).toBe(false);
  });
});

describe("canAdjustSkill / canRateNewHire — GM own shop, MoO+ any, and the actor outranks the subject", () => {
  const subject = { role: "employee" as RoleCode };
  for (const role of ALL_ROLES) {
    for (const where of ["own", "other", "none"] as const) {
      const want = expectGmOwnMooAny(role, where);
      it(`${role} @ ${where} on an employee → ${want}`, () => {
        expect(canAdjustSkill(actor(role, where), subject, shopFor(where))).toBe(want);
        expect(canRateNewHire(actor(role, where), subject, shopFor(where))).toBe(want);
      });
    }
  }
  it("a GM cannot adjust a GM (canActOn is strict), nor themselves", () => {
    expect(canAdjustSkill(actor("gm"), { role: "gm" }, OWN)).toBe(false);
    expect(canAdjustSkill(actor("gm"), { role: "moo" }, OWN)).toBe(false);
  });
  it("a GM can adjust an AGM and a shift lead at its own shop", () => {
    expect(canAdjustSkill(actor("gm"), { role: "agm" }, OWN)).toBe(true);
    expect(canAdjustSkill(actor("gm"), { role: "shift_lead" }, OWN)).toBe(true);
  });
  it("a MoO can adjust a GM at any shop, but not another MoO", () => {
    expect(canAdjustSkill(actor("moo", "none"), { role: "gm" }, OTHER)).toBe(true);
    expect(canAdjustSkill(actor("moo"), { role: "moo" }, OWN)).toBe(false);
  });
});

describe("canEditPeopleSettings / canEditPmCriteria — GM own shop, MoO+ any", () => {
  for (const role of ALL_ROLES) {
    for (const where of ["own", "other", "none"] as const) {
      const want = expectGmOwnMooAny(role, where);
      it(`${role} @ ${where} → ${want}`, () => {
        expect(canEditPeopleSettings(actor(role, where), shopFor(where))).toBe(want);
        expect(canEditPmCriteria(actor(role, where), shopFor(where))).toBe(want);
      });
    }
  }
});

describe("company-level acts — MoO (8)+ only, whatever the shop", () => {
  for (const role of ALL_ROLES) {
    const want = MOO_PLUS.includes(role);
    it(`${role} → ${want}`, () => {
      for (const where of ["own", "none"] as const) {
        expect(canManageSevenShiftsShops(actor(role, where))).toBe(want);
        expect(canSyncNow(actor(role, where))).toBe(want);
        expect(canSeeWageRates(actor(role, where))).toBe(want);
        expect(canEditSkillTunables(actor(role, where))).toBe(want);
      }
    });
  }
});

describe("canLinkSevenShiftsUser — GM own shop (subject a member there), MoO+ any; actor ≥ subject level", () => {
  for (const role of ALL_ROLES) {
    for (const where of ["own", "other", "none"] as const) {
      const want = expectGmOwnMooAny(role, where);
      it(`${role} @ ${where} linking an employee who works there → ${want}`, () => {
        const shop = shopFor(where);
        expect(canLinkSevenShiftsUser(actor(role, where), 3, [shop], shop)).toBe(want);
      });
    }
  }
  it("a GM cannot link someone who holds no membership at the shop", () => {
    expect(canLinkSevenShiftsUser(actor("gm"), 3, [OTHER], OWN)).toBe(false);
    expect(canLinkSevenShiftsUser(actor("gm"), 3, [], OWN)).toBe(false);
  });
  it("a GM may link a peer GM (≥, not >) but not a MoO", () => {
    expect(canLinkSevenShiftsUser(actor("gm"), 7, [OWN], OWN)).toBe(true);
    expect(canLinkSevenShiftsUser(actor("gm"), 8, [OWN], OWN)).toBe(false);
  });
  it("a MoO may link at any shop, but not someone above them", () => {
    expect(canLinkSevenShiftsUser(actor("moo", "none"), 7, [OTHER], OTHER)).toBe(true);
    expect(canLinkSevenShiftsUser(actor("moo", "none"), 9, [], OTHER)).toBe(false);
  });
});

describe("canViewSevenShiftsStatus — GM and Op-6 own shop, MoO+ any, SMM never", () => {
  for (const role of ALL_ROLES) {
    for (const where of ["own", "other", "none"] as const) {
      const want = expectViewPeople(role, where);
      it(`${role} @ ${where} → ${want}`, () => {
        expect(canViewSevenShiftsStatus(actor(role, where), shopFor(where))).toBe(want);
      });
    }
  }
});

describe("canSeeShopLaborTotals (R5) — GM own shop, MoO+ any; nobody else", () => {
  for (const role of ALL_ROLES) {
    for (const where of ["own", "other", "none"] as const) {
      const want = expectGmOwnMooAny(role, where);
      it(`${role} @ ${where} → ${want}`, () => {
        expect(canSeeShopLaborTotals(actor(role, where), shopFor(where))).toBe(want);
      });
    }
  }
  it("a GM sees totals but never individual rates", () => {
    expect(canSeeShopLaborTotals(actor("gm"), OWN)).toBe(true);
    expect(canSeeWageRates(actor("gm"))).toBe(false);
  });
});

describe("canSubmitPmDay — KH+ and never SMM (task access is checked in the I/O half)", () => {
  for (const role of ALL_ROLES) {
    const want = ROLES[role].level >= 4 && role !== "social_media_mgr";
    it(`${role} → ${want}`, () => {
      expect(canSubmitPmDay(actor(role))).toBe(want);
    });
  }
});

describe("PM_COPY_TRANSITIONS — the ONE lifecycle, exported as data", () => {
  it("is exactly the plan's table", () => {
    expect(PM_COPY_TRANSITIONS).toEqual({
      write: { from: ["open"], to: "open" },
      markDone: { from: ["open"], to: "done" },
      reopen: { from: ["done"], to: "open" },
      seal: { from: ["open", "done"], to: "sealed" },
    });
  });

  const author = actor("key_holder");
  const stranger = actor("shift_lead", "own", "someone-else");
  for (const c of lifecycle.cases) {
    it(`${c.act} on a ${c.copy} copy, day ${c.day}, ${c.author ? "author" : "not author"} → ${c.expect ?? "allowed"}`, () => {
      const who = c.author ? author : stranger;
      const copy = { authorId: author.userId, locationId: OWN, status: c.copy as PmCopyStatus };
      const day = { locationId: OWN, status: (c.day === "open" ? "open" : "submitted") as PmDayStatus, authorIds: [author.userId] };
      expect(pmCopyActRefusal(c.act as PmCopyAct, who, copy, day)).toBe(c.expect);
    });
  }

  it("the boolean rules agree with the case file", () => {
    for (const c of lifecycle.cases) {
      const who = c.author ? author : stranger;
      const copy = { authorId: author.userId, locationId: OWN, status: c.copy as PmCopyStatus };
      const day = { locationId: OWN, status: (c.day === "open" ? "open" : "submitted") as PmDayStatus, authorIds: [author.userId] };
      const allowed = c.expect === null;
      if (c.act === "write") expect(canWritePmCopy(who, copy, day)).toBe(allowed);
      if (c.act === "markDone") expect(canMarkDone(who, copy, day)).toBe(allowed);
      if (c.act === "reopen") expect(canReopenPmCopy(who, copy, day)).toBe(allowed);
    }
  });

  it("an SMM author (should never exist) is still refused every copy write", () => {
    const smm = actor("social_media_mgr");
    const copy = { authorId: smm.userId, locationId: OWN, status: "open" as const };
    const day = { locationId: OWN, status: "open" as const, authorIds: [smm.userId] };
    expect(pmCopyActRefusal("write", smm, copy, day)).toBe("forbidden");
    expect(canWritePmCopy(smm, copy, day)).toBe(false);
    expect(canMarkDone(smm, copy, day)).toBe(false);
  });

  it("a below-KH author is refused (the KH+ floor holds inside the copy rules too)", () => {
    const emp = actor("employee");
    const copy = { authorId: emp.userId, locationId: OWN, status: "open" as const };
    const day = { locationId: OWN, status: "open" as const, authorIds: [emp.userId] };
    expect(canWritePmCopy(emp, copy, day)).toBe(false);
  });

  it("a copy at another shop than its day is refused (never trust a mismatched pair)", () => {
    const copy = { authorId: author.userId, locationId: OTHER, status: "open" as const };
    const day = { locationId: OWN, status: "open" as const, authorIds: [author.userId] };
    expect(pmCopyActRefusal("write", author, copy, day)).toBe("forbidden");
  });
});

describe("canReadPmCopy — blind until submit, then authors, GM/Op-6 of the shop, MoO+", () => {
  const authorId = "author-1";
  const coAuthorId = "author-2";
  const copy = { authorId, locationId: OWN, status: "open" as PmCopyStatus };
  const openDay = { locationId: OWN, status: "open" as PmDayStatus, authorIds: [authorId, coAuthorId] };

  it("the author reads their own copy before and after submit", () => {
    const a = actor("key_holder", "own", authorId);
    expect(canReadPmCopy(a, copy, openDay)).toBe(true);
    for (const status of ["submitted", "incomplete_confirmed", "auto_finalized"] as const) {
      expect(canReadPmCopy(a, { ...copy, status: "sealed" }, { ...openDay, status })).toBe(true);
    }
  });

  it("BEFORE submit nobody else reads it — MoO and Owner included", () => {
    for (const role of ALL_ROLES) {
      expect(canReadPmCopy(actor(role, "own", `other-${role}`), copy, openDay)).toBe(false);
    }
    expect(canReadPmCopy(actor("shift_lead", "own", coAuthorId), copy, openDay)).toBe(false);
  });

  for (const status of ["submitted", "incomplete_confirmed", "auto_finalized"] as const) {
    describe(`AFTER submit (${status})`, () => {
      const day = { ...openDay, status };
      const sealed = { ...copy, status: "sealed" as PmCopyStatus };
      for (const role of ALL_ROLES) {
        for (const where of ["own", "other", "none"] as const) {
          const want = expectViewPeople(role, where);
          it(`a non-author ${role} @ ${where} → ${want}`, () => {
            const day2 = { ...day, locationId: shopFor(where) };
            const copy2 = { ...sealed, locationId: shopFor(where) };
            expect(canReadPmCopy(actor(role, where, `x-${role}`), copy2, day2)).toBe(want);
          });
        }
      }
      it("another author of that day reads it (even a KH, J9)", () => {
        expect(canReadPmCopy(actor("key_holder", "own", coAuthorId), sealed, day)).toBe(true);
      });
      it("a KH or SL of the shop who wrote no copy does not (J9)", () => {
        expect(canReadPmCopy(actor("key_holder", "own", "kh-x"), sealed, day)).toBe(false);
        expect(canReadPmCopy(actor("shift_lead", "own", "sl-x"), sealed, day)).toBe(false);
      });
    });
  }
});

describe("canManageSevenShiftsPeople — the person-link screen's act gate: GM own shop, MoO+ any (Task 10)", () => {
  for (const role of ALL_ROLES) {
    for (const where of ["own", "other", "none"] as const) {
      const want = expectGmOwnMooAny(role, where);
      it(`${role} @ ${where} → ${want}`, () => {
        expect(canManageSevenShiftsPeople(actor(role, where), shopFor(where))).toBe(want);
      });
    }
  }
  it("is never true for 'all' or an empty shop", () => {
    expect(canManageSevenShiftsPeople(actor("owner"), "all")).toBe(false);
    expect(canManageSevenShiftsPeople(actor("owner"), "")).toBe(false);
  });
  it("agrees with canLinkSevenShiftsUser for a subject who works there at a lower level", () => {
    for (const role of ALL_ROLES) for (const where of ["own", "other", "none"] as const) {
      const shop = shopFor(where);
      expect(canManageSevenShiftsPeople(actor(role, where), shop)).toBe(canLinkSevenShiftsUser(actor(role, where), 0, [shop], shop));
    }
  });
});
