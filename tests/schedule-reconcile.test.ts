/**
 * Scheduling Phase 2, chunk G, Task 25 — THE THREE-WAY RECONCILIATION, pure (plan §8.0, J24, r2 P2-11).
 *
 * Each CO-OPS member is a row (the anchor) with three ticks: CO-OPS · Toast · 7shifts. NOTHING links by name: a Toast
 * employee joins a person only through an active `toast_employee_links` row at this shop, a 7shifts user only through an
 * active `sevenshifts_user_links` row. Attendance is judged against the schedule people actually FOLLOW: the PUBLISHED
 * mirrored 7shifts shifts (draft = false, not deleted) when that day has them; otherwise the row is labelled "against
 * the CO-OPS proposal (not published)", its discrepancies are informational (`proposal_differs`) and the missing
 * evidence is named. Toast stays the backup source of actual hours (`sources_disagree` > 15 min).
 */
import { describe, expect, it } from "vitest";
import { RECONCILE_FLAG_CODES, reconcile, type ReconcileInput } from "@/lib/scheduling/reconcile-shared";

// Wed Oct 14 2026 (EDT, UTC−4) and Thu Oct 15.
const D1 = "2026-10-14";
const D2 = "2026-10-15";
const at = (date: string, hhmm: string) => `${date}T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, "0")}:${hhmm.slice(3)}:00.000Z`;
const ANA = "00000000-0000-4000-8000-0000000000a1";
const ANA2 = "00000000-0000-4000-8000-0000000000a2"; // another "Ana": same first name, a different person
const BEN = "00000000-0000-4000-8000-0000000000b1";

function base(over: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    dates: [D1, D2],
    sevenStatus: "ready",
    shopLinkedToSeven: true,
    members: [{ userId: ANA, name: "Ana Ruiz" }, { userId: ANA2, name: "Ana Soto" }, { userId: BEN, name: "Ben Lee" }],
    toastLinks: [{ employeeGuid: "tg-ana", userId: ANA }, { employeeGuid: "tg-ana2", userId: ANA2 }, { employeeGuid: "tg-ben", userId: BEN }],
    sevenLinks: [{ sevenUserId: "701", userId: ANA }, { sevenUserId: "702", userId: ANA2 }, { sevenUserId: "703", userId: BEN }],
    sevenUsersAtShop: [{ sevenUserId: "701", displayName: "Ana R.", employeeId: "E1" }, { sevenUserId: "702", displayName: "Ana S.", employeeId: "E2" }, { sevenUserId: "703", displayName: "Ben L.", employeeId: "E3" }],
    toastPunches14d: [],
    sevenPunches14d: [],
    publishedSevenShifts14d: [],
    coopsProposalShifts14d: [],
    coopsProposalDates: [D1, D2],
    // Observed well after the window: every record is completed attendance unless a test says otherwise.
    now: "2026-10-20T12:00:00.000Z",
    sevenInactiveAtShop: 0,
    ...over,
  };
}
const row = (out: ReturnType<typeof reconcile>, id: string) => out.rows.find((r) => r.userId === id)!;
const codes = (r: { flags: Array<{ code: string }> }) => r.flags.map((f) => f.code);
const punch = (guid: string, date: string, from: string, to: string | null, first = "Ana") =>
  ({ employeeGuid: guid, firstName: first, businessDate: date, inAt: at(date, from), outAt: to === null ? null : at(date, to), hours: null });
const published = (seven: string, date: string, from: string, to: string, draft: boolean | null = false, deleted = false) =>
  ({ sevenUserId: seven, startAt: at(date, from), endAt: at(date, to), draft, deleted });

describe("ticks and identity flags — the CO-OPS user is the anchor; nothing links by name", () => {
  it("every member is a row with three ticks; all linked → no identity flag", () => {
    const out = reconcile(base());
    expect(out.rows.map((r) => r.userId).sort()).toEqual([ANA, ANA2, BEN].sort());
    for (const r of out.rows) {
      expect(r.ticks).toEqual({ coops: true, toast: "linked", seven: "linked" });
      expect(r.flags).toEqual([]);
    }
  });

  it("member_no_toast / member_no_seven, each a named reason key", () => {
    const out = reconcile(base({ toastLinks: [{ employeeGuid: "tg-ana", userId: ANA }], sevenLinks: [{ sevenUserId: "701", userId: ANA }] }));
    expect(row(out, BEN).ticks).toEqual({ coops: true, toast: "missing", seven: "missing" });
    expect(codes(row(out, BEN))).toEqual(["member_no_toast", "member_no_seven"]);
    expect(codes(row(out, ANA))).toEqual([]);
  });

  it("7shifts not ready → the tick reads not_connected and no member_no_seven is raised", () => {
    const out = reconcile(base({ sevenStatus: "sync_off", sevenLinks: [], sevenUsersAtShop: [] }));
    for (const r of out.rows) {
      expect(r.ticks.seven).toBe("not_connected");
      expect(codes(r)).not.toContain("member_no_seven");
    }
    expect(out.sevenUnlinked).toEqual([]);
  });

  it("toast_clockin_no_user: an employee guid with punches and no active link here — FIRST name only, one row per guid", () => {
    const out = reconcile(base({ toastPunches14d: [punch("tg-x", D1, "11:00", "15:00", "Ana"), punch("tg-x", D2, "11:00", "15:00", "Ana"), punch("tg-y", D1, "07:00", "11:00", "Ana")] }));
    expect(out.toastUnlinked).toEqual([
      { employeeGuid: "tg-x", firstName: "Ana", punchDays: 2, flags: [{ code: "toast_clockin_no_user" }] },
      { employeeGuid: "tg-y", firstName: "Ana", punchDays: 1, flags: [{ code: "toast_clockin_no_user" }] },
    ]);
    // Neither is attached to a CO-OPS Ana by her name.
    expect(codes(row(out, ANA))).toEqual([]);
    expect(codes(row(out, ANA2))).toEqual([]);
  });

  it("seven_user_unlinked: a 7shifts user assigned at the linked location with no link", () => {
    const out = reconcile(base({ sevenUsersAtShop: [...base().sevenUsersAtShop, { sevenUserId: "799", displayName: "Ana T.", employeeId: "E9" }] }));
    expect(out.sevenUnlinked).toEqual([{ sevenUserId: "799", displayName: "Ana T.", employeeId: "E9", flags: [{ code: "seven_user_unlinked" }] }]);
  });

  it("two people with the same first name stay separate: Ana Ruiz's punches never land on Ana Soto", () => {
    const out = reconcile(base({
      publishedSevenShifts14d: [published("701", D1, "11:00", "15:00"), published("702", D1, "16:00", "20:00")],
      toastPunches14d: [punch("tg-ana", D1, "11:00", "15:00")],
    }));
    expect(codes(row(out, ANA))).toEqual([]);
    expect(row(out, ANA2).flags).toEqual([{ code: "shift_no_punch", date: D1, params: { startAt: at(D1, "16:00"), endAt: at(D1, "20:00") } }]);
  });
});

describe("attendance against the PUBLISHED 7shifts schedule", () => {
  it("shift_no_punch and punch_no_shift, against published shifts", () => {
    const out = reconcile(base({
      publishedSevenShifts14d: [published("701", D1, "11:00", "15:00"), published("703", D1, "07:00", "11:00")],
      toastPunches14d: [punch("tg-ana", D1, "16:00", "18:00")],
    }));
    expect(row(out, ANA).flags).toEqual([
      { code: "shift_no_punch", date: D1, params: { startAt: at(D1, "11:00"), endAt: at(D1, "15:00") } },
      { code: "punch_no_shift", date: D1, params: { inAt: at(D1, "16:00"), outAt: at(D1, "18:00") } },
    ]);
    expect(row(out, ANA).days.find((d) => d.date === D1)).toMatchObject({ basis: "published", missing: null });
    expect(codes(row(out, BEN))).toEqual(["shift_no_punch"]);
  });

  it("a person scheduled by nobody but who punched on a published day → punch_no_shift", () => {
    const out = reconcile(base({ publishedSevenShifts14d: [published("703", D1, "07:00", "11:00")], toastPunches14d: [punch("tg-ana", D1, "11:00", "13:00"), punch("tg-ben", D1, "07:00", "11:00", "Ben")] }));
    expect(codes(row(out, ANA))).toEqual(["punch_no_shift"]);
    expect(codes(row(out, BEN))).toEqual([]);
  });

  it("a FOLLOWER of the published schedule whose CO-OPS proposal differed gets NO punch_no_shift and NO shift_no_punch", () => {
    const out = reconcile(base({
      coopsProposalShifts14d: [{ userId: ANA, date: D1, startQ: 28, endQ: 44 }], // CO-OPS proposed 7:00–11:00
      publishedSevenShifts14d: [published("701", D1, "12:00", "18:00")], // the manager published 12:00–18:00 in 7shifts
      toastPunches14d: [punch("tg-ana", D1, "11:55", "18:05")], // she followed the published schedule
    }));
    expect(row(out, ANA).flags).toEqual([]);
    expect(row(out, ANA).days.find((d) => d.date === D1)).toMatchObject({ basis: "published" });
  });

  it("a 7shifts DRAFT (draft = true) or a deleted shift is never treated as published", () => {
    const drafts = [published("701", D1, "11:00", "15:00", true), published("701", D1, "11:00", "15:00", false, true), published("701", D1, "11:00", "15:00", null)];
    const out = reconcile(base({ publishedSevenShifts14d: drafts, toastPunches14d: [punch("tg-ana", D1, "16:00", "18:00")] }));
    const day = row(out, ANA).days.find((d) => d.date === D1)!;
    expect(day.basis).toBe("proposal_not_published");
    expect(codes(row(out, ANA))).not.toContain("punch_no_shift");
    expect(codes(row(out, ANA))).not.toContain("shift_no_punch");
  });

  it("7shifts punches count as attendance too (linked user)", () => {
    const out = reconcile(base({ publishedSevenShifts14d: [published("701", D1, "11:00", "15:00")], sevenPunches14d: [{ sevenUserId: "701", clockedIn: at(D1, "11:02"), clockedOut: at(D1, "15:00"), breakMinutes: 0 }] }));
    expect(codes(row(out, ANA))).toEqual([]);
  });
});

describe("no published data → 'against the CO-OPS proposal (not published)', informational, with the missing evidence", () => {
  it("an unused CO-OPS proposal with no published data → proposal_differs, labelled not published, evidence named", () => {
    const out = reconcile(base({ coopsProposalShifts14d: [{ userId: ANA, date: D1, startQ: 44, endQ: 60 }], toastPunches14d: [] }));
    const day = row(out, ANA).days.find((d) => d.date === D1)!;
    expect(day).toMatchObject({ basis: "proposal_not_published", missing: "no_published_shifts" });
    expect(row(out, ANA).flags).toEqual([{ code: "proposal_differs", date: D1 }]);
    expect(codes(row(out, ANA))).not.toContain("shift_no_punch");
  });

  it("never punch_no_shift / shift_no_punch without a published schedule — whatever the punches", () => {
    const out = reconcile(base({ coopsProposalShifts14d: [{ userId: ANA, date: D1, startQ: 44, endQ: 60 }], toastPunches14d: [punch("tg-ana", D1, "16:00", "20:00")] }));
    expect(codes(row(out, ANA))).toEqual(["proposal_differs"]);
    // Punches that match the proposal → nothing to say.
    const same = reconcile(base({ coopsProposalShifts14d: [{ userId: ANA, date: D1, startQ: 44, endQ: 60 }], toastPunches14d: [punch("tg-ana", D1, "11:00", "15:00")] }));
    expect(codes(row(same, ANA))).toEqual([]);
  });

  it("the missing-evidence line names WHY: 7shifts not connected, the shop not linked, the person not linked, no shifts mirrored", () => {
    const prop = { coopsProposalShifts14d: [{ userId: ANA, date: D1, startQ: 44, endQ: 60 }] };
    const day = (o: Partial<ReconcileInput>) => row(reconcile(base({ ...prop, ...o })), ANA).days.find((d) => d.date === D1)!.missing;
    expect(day({ sevenStatus: "not_connected", sevenLinks: [], sevenUsersAtShop: [] })).toBe("seven_not_connected");
    expect(day({ shopLinkedToSeven: false, sevenUsersAtShop: [] })).toBe("shop_not_linked");
    expect(day({ sevenLinks: [], publishedSevenShifts14d: [published("703", D1, "07:00", "11:00")] })).toBe("person_not_linked");
    expect(day({})).toBe("no_published_shifts");
    // Neither a published schedule nor a link: the line is there.
    expect(day({ sevenLinks: [] })).toBe("person_not_linked");
  });

  it("a day with no CO-OPS proposal and no published schedule is not compared (evidence only, no flag)", () => {
    const out = reconcile(base({ coopsProposalDates: [], toastPunches14d: [punch("tg-ana", D1, "11:00", "15:00")] }));
    expect(codes(row(out, ANA))).toEqual([]);
    expect(row(out, ANA).days.find((d) => d.date === D1)).toMatchObject({ basis: "proposal_not_published", missing: "no_published_shifts", proposal: false });
  });
});

describe("sources_disagree: 7shifts punch hours vs Toast hours > 15 min for a person-day (Toast stays the backup source)", () => {
  it("over 15 minutes apart → flagged with both numbers; within 15 → nothing", () => {
    const pub = [published("701", D1, "11:00", "17:00")];
    const far = reconcile(base({ publishedSevenShifts14d: pub, toastPunches14d: [punch("tg-ana", D1, "11:00", "17:00")], sevenPunches14d: [{ sevenUserId: "701", clockedIn: at(D1, "11:00"), clockedOut: at(D1, "16:30"), breakMinutes: 0 }] }));
    expect(row(far, ANA).flags).toEqual([{ code: "sources_disagree", date: D1, params: { toastHours: 6, sevenHours: 5.5 } }]);
    const near = reconcile(base({ publishedSevenShifts14d: pub, toastPunches14d: [punch("tg-ana", D1, "11:00", "17:00")], sevenPunches14d: [{ sevenUserId: "701", clockedIn: at(D1, "11:00"), clockedOut: at(D1, "16:50"), breakMinutes: 0 }] }));
    expect(codes(row(near, ANA))).toEqual([]);
  });
});

describe("order and vocabulary", () => {
  it("rows sort flags first, then name; every flag code is in the closed list", () => {
    const out = reconcile(base({ toastLinks: [{ employeeGuid: "tg-ana", userId: ANA }, { employeeGuid: "tg-ana2", userId: ANA2 }] }));
    expect(out.rows.map((r) => r.userId)).toEqual([BEN, ANA, ANA2]);
    for (const r of out.rows) for (const f of r.flags) expect(RECONCILE_FLAG_CODES).toContain(f.code);
    expect(out.counts).toEqual({ people: 3, flagged: 1, toastUnlinked: 0, sevenUnlinked: 0, sevenInactiveHidden: 0 });
  });

  it("is pure and deterministic: the same input twice gives the same output, input order does not matter", () => {
    const a = base({ publishedSevenShifts14d: [published("701", D1, "11:00", "15:00"), published("703", D2, "07:00", "11:00")], toastPunches14d: [punch("tg-ana", D2, "11:00", "12:00")] });
    const b = { ...a, members: [...a.members].reverse(), publishedSevenShifts14d: [...a.publishedSevenShifts14d].reverse() };
    expect(reconcile(b)).toEqual(reconcile(a));
  });
});

describe("Astra chunk G review — open and upcoming records, DST, informational flags, inactive 7shifts users", () => {
  it("P2-2: her case — published 12:00–18:00, clock-in 11:55, no clock-out yet → 'on shift now', never punch_no_shift / shift_no_punch", () => {
    const pub = [published("701", D1, "12:00", "18:00")];
    for (const now of [at(D1, "13:00"), at(D1, "11:58"), at(D1, "17:59")]) {
      const out = reconcile(base({ now, dates: [D1], publishedSevenShifts14d: pub, toastPunches14d: [punch("tg-ana", D1, "11:55", null)] }));
      expect(row(out, ANA).flags).toEqual([]);
      expect(row(out, ANA).days[0]).toMatchObject({ date: D1, basis: "published", onShiftNow: true });
    }
    // The same through a 7shifts punch still open.
    const seven = reconcile(base({ now: at(D1, "13:00"), dates: [D1], publishedSevenShifts14d: pub, sevenPunches14d: [{ sevenUserId: "701", clockedIn: at(D1, "11:55"), clockedOut: null, breakMinutes: null }] }));
    expect(row(seven, ANA).flags).toEqual([]);
    expect(row(seven, ANA).days[0]!.onShiftNow).toBe(true);
    // An open punch never makes the two sources "disagree" (one source has no hours yet).
    const both = reconcile(base({ now: at(D1, "13:00"), dates: [D1], publishedSevenShifts14d: pub, toastPunches14d: [punch("tg-ana", D1, "11:55", null)], sevenPunches14d: [{ sevenUserId: "701", clockedIn: at(D1, "08:00"), clockedOut: at(D1, "10:00"), breakMinutes: 0 }] }));
    expect(codes(row(both, ANA))).not.toContain("sources_disagree");
    // A CLOSED punch on the same day is completed attendance: nothing open.
    const closed = reconcile(base({ now: at(D1, "19:00"), dates: [D1], publishedSevenShifts14d: pub, toastPunches14d: [punch("tg-ana", D1, "11:55", "18:05")] }));
    expect(row(closed, ANA).days[0]).toMatchObject({ onShiftNow: false, upcoming: 0 });
    expect(row(closed, ANA).flags).toEqual([]);
  });

  it("P2-2: a shift that has not started yet is 'upcoming', never shift_no_punch (published and proposal alike)", () => {
    const out = reconcile(base({ now: at(D1, "10:00"), dates: [D1], publishedSevenShifts14d: [published("703", D1, "12:00", "18:00"), published("701", D1, "07:00", "09:00")] }));
    expect(row(out, BEN).flags).toEqual([]);
    expect(row(out, BEN).days[0]).toMatchObject({ basis: "published", upcoming: 1, onShiftNow: false });
    // A shift that already started with no punch is still a shift with no punch.
    expect(codes(row(out, ANA))).toEqual(["shift_no_punch"]);
    expect(row(out, ANA).days[0]!.upcoming).toBe(0);
    // Not published: a proposal shift still to come is not a difference.
    const prop = reconcile(base({ now: at(D1, "10:00"), dates: [D1], sevenStatus: "not_connected", sevenLinks: [], sevenUsersAtShop: [], coopsProposalShifts14d: [{ userId: ANA, date: D1, startQ: 48, endQ: 64 }] }));
    expect(row(prop, ANA).flags).toEqual([]);
    expect(row(prop, ANA).days[0]).toMatchObject({ basis: "proposal_not_published", upcoming: 1 });
    // A later date is entirely upcoming.
    const later = reconcile(base({ now: at(D1, "10:00"), publishedSevenShifts14d: [published("703", D2, "07:00", "11:00")] }));
    expect(codes(row(later, BEN))).toEqual([]);
    expect(row(later, BEN).days.find((d) => d.date === D2)!.upcoming).toBe(1);
  });

  it("P2-3: DST — on Sun Nov 1, 2026 (EDT → EST at 2 AM) a 07:00–11:00 proposal is 07:00–11:00 EST, so a 10:15–11:00 punch matches it", () => {
    const NOV1 = "2026-11-01";
    const out = reconcile(base({
      now: "2026-11-02T12:00:00.000Z", dates: [NOV1], sevenStatus: "not_connected", sevenLinks: [], sevenUsersAtShop: [], coopsProposalDates: [NOV1],
      coopsProposalShifts14d: [{ userId: ANA, date: NOV1, startQ: 28, endQ: 44 }],
      // 10:15–11:00 EST = 15:15Z–16:00Z.
      toastPunches14d: [{ employeeGuid: "tg-ana", firstName: "Ana", businessDate: NOV1, inAt: "2026-11-01T15:15:00.000Z", outAt: "2026-11-01T16:00:00.000Z", hours: null }],
    }));
    expect(row(out, ANA).flags).toEqual([]);
    // And a punch at 06:15–06:45 EST (11:15Z–11:45Z) — outside 07:00–11:00 EST — IS a difference.
    const off = reconcile(base({
      now: "2026-11-02T12:00:00.000Z", dates: [NOV1], sevenStatus: "not_connected", sevenLinks: [], sevenUsersAtShop: [], coopsProposalDates: [NOV1],
      coopsProposalShifts14d: [{ userId: ANA, date: NOV1, startQ: 28, endQ: 44 }],
      toastPunches14d: [{ employeeGuid: "tg-ana", firstName: "Ana", businessDate: NOV1, inAt: "2026-11-01T11:15:00.000Z", outAt: "2026-11-01T11:45:00.000Z", hours: null }],
    }));
    expect(codes(row(off, ANA))).toEqual(["proposal_differs"]);
  });

  it("P2-4: informational flags stay visible as detail but never count as 'needs a look' — her flagged: 1 → 0", () => {
    const out = reconcile(base({ coopsProposalShifts14d: [{ userId: ANA, date: D1, startQ: 44, endQ: 60 }] }));
    expect(codes(row(out, ANA))).toEqual(["proposal_differs"]);
    expect(row(out, ANA).lookAt).toBe(0);
    expect(out.counts.flagged).toBe(0);
    // Ordering: an informational-only row is not sorted ahead of others as if it needed a look.
    expect(out.rows.map((r) => r.userId)).toEqual([ANA, ANA2, BEN]);
    // A real flag still counts and sorts first.
    const real = reconcile(base({ coopsProposalShifts14d: [{ userId: ANA, date: D1, startQ: 44, endQ: 60 }], toastLinks: [{ employeeGuid: "tg-ana", userId: ANA }, { employeeGuid: "tg-ana2", userId: ANA2 }] }));
    expect(real.counts.flagged).toBe(1);
    expect(real.rows[0]!.userId).toBe(BEN);
    expect(row(real, BEN).lookAt).toBe(1);
  });

  it("P3-5: inactive 7shifts users at the shop are hidden from the unlinked list but counted separately", () => {
    const out = reconcile(base({ sevenInactiveAtShop: 3 }));
    expect(out.counts.sevenInactiveHidden).toBe(3);
    expect(reconcile(base()).counts.sevenInactiveHidden).toBe(0);
    // Not ready / shop not linked: nothing is read, nothing is counted.
    expect(reconcile(base({ sevenStatus: "sync_off", sevenInactiveAtShop: 3 })).counts.sevenInactiveHidden).toBe(0);
  });
});
