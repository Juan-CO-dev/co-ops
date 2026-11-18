// Item 2, salaried cost to the PAYROLL shop (plan r2 + Astra r2). THE allocation rule and THE census, pure.
//  - allocateSalaried: the assignment in force at the week start (greatest valid_from <= week, then seq) is the
//    ONLY authority; links never enter it (P1-1). An assignment whose destination is not stored this week is
//    UNPLACED before the wage is looked at (Astra r2 P2 #3), so a missing-wage gap can never vanish with a
//    removed location link.
//  - payrollCensus: every 7shifts account in the mirror is classified, so an account with no wage, no punch,
//    no link and no assignment is NEVER silently missing (Astra r2 P1): it is a "needs a decision" gap, and a
//    payroll-roster manager with no 7shifts account at all is named too.
import { describe, expect, it } from "vitest";
import {
  allocateSalaried, payrollCensus, payrollRowInForce, PAYROLL_ROSTER_ROLES, type PayrollShopRow, type CensusInput,
} from "@/lib/facts/labor-payroll-shared";
import type { WageVersion } from "@/lib/facts/labor-wages-shared";

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b", C = "00000000-0000-4000-8000-00000000000c";
const WEEK = "2026-10-04";
let seq = 1;
const wage = (user: string, cents: number, o: Partial<WageVersion> = {}): WageVersion => ({ user_id: user, wage_id: String(seq++), upcoming: false,
  effective_date: "2026-01-01", wage_type: "weekly_salary", wage_cents: cents, role_id: null, active: true, seq: seq++, ...o });
const row = (account: string, o: Partial<PayrollShopRow>): PayrollShopRow => ({ seq: seq++, sevenshifts_user_id: account, location_id: A,
  disposition: "shop", valid_from: "2026-07-19", ...o });
const alloc = (payrollShops: PayrollShopRow[], wages: WageVersion[], storedShops = [A, B], weekStart = WEEK) =>
  allocateSalaried({ weekStart, storedShops, payrollShops, wages });

describe("allocateSalaried: the plan §2 table", () => {
  it("salaried + shop S stored: 100% of the weekly amount to S (weekly and annual)", () => {
    const out = alloc([row("9", { location_id: A }), row("10", { location_id: B })],
      [wage("9", 200000), wage("10", 5200000, { wage_type: "annual_salary" })]);
    expect(out.rows).toEqual([
      { location_id: A, salaried_cents: 200000, salaried_people: 1, unplaced_people: 0, missing_wage_people: 0 },
      { location_id: B, salaried_cents: 100000, salaried_people: 1, unplaced_people: 0, missing_wage_people: 0 },
    ]);
  });
  it("salaried + excluded: nothing, a recorded decision (not a gap)", () => {
    const out = alloc([row("9", { disposition: "excluded", location_id: null })], [wage("9", 200000)]);
    expect(out.rows.every((r) => r.salaried_cents === null && r.unplaced_people === 0 && r.missing_wage_people === 0)).toBe(true);
    expect(out.accounts).toEqual([{ account: "9", state: "excluded", location_id: null, weekly_cents: 200000 }]);
  });
  it("salaried + no assignment: UNPLACED, every stored shop incomplete (never the complete person's cents alone)", () => {
    const out = alloc([row("9", { location_id: A })], [wage("9", 200000), wage("11", 150000)]);
    expect(out.rows).toEqual([
      { location_id: A, salaried_cents: null, salaried_people: 1, unplaced_people: 1, missing_wage_people: 0 },
      { location_id: B, salaried_cents: null, salaried_people: 0, unplaced_people: 1, missing_wage_people: 0 },
    ]);
  });
  it("salaried + shop S NOT stored this week: unplaced", () => {
    const out = alloc([row("9", { location_id: C })], [wage("9", 200000)]);
    expect(out.rows.map((r) => [r.salaried_cents, r.unplaced_people])).toEqual([[null, 1], [null, 1]]);
    expect(out.accounts[0]!.state).toBe("unplaced_destination");
  });
  it("no salary + shop S stored: missing wage at S only", () => {
    const out = alloc([row("9", { location_id: A }), row("12", { location_id: B })], [wage("12", 90000)]);
    expect(out.rows).toEqual([
      { location_id: A, salaried_cents: null, salaried_people: 0, unplaced_people: 0, missing_wage_people: 1 },
      { location_id: B, salaried_cents: 90000, salaried_people: 1, unplaced_people: 0, missing_wage_people: 0 },
    ]);
  });
  it("an hourly wage + shop S: missing (salary) wage at S", () => {
    const out = alloc([row("9", { location_id: A })], [wage("9", 2000, { wage_type: "hourly" })]);
    expect(out.rows[0]).toMatchObject({ location_id: A, missing_wage_people: 1, salaried_cents: null });
  });
  it("no salary + none or excluded: ignored", () => {
    const out = alloc([row("9", { disposition: "excluded", location_id: null })], [wage("13", 2000, { wage_type: "hourly" })]);
    expect(out.rows).toEqual([
      { location_id: A, salaried_cents: null, salaried_people: 0, unplaced_people: 0, missing_wage_people: 0 },
      { location_id: B, salaried_cents: null, salaried_people: 0, unplaced_people: 0, missing_wage_people: 0 },
    ]);
  });
});

describe("Astra r2 P2 #3: a destination that is no longer stored never drops a gap", () => {
  it("no wage + shop S whose location link was removed: UNPLACED on every stored shop (classified before the wage)", () => {
    const out = alloc([row("9", { location_id: A }), row("10", { location_id: B })], [wage("10", 100000)], [B]);
    expect(out.rows).toEqual([{ location_id: B, salaried_cents: null, salaried_people: 1, unplaced_people: 1, missing_wage_people: 0 }]);
    expect(out.accounts.find((a) => a.account === "9")!.state).toBe("unplaced_destination");
  });
  it("salaried + shop S whose location link was removed: unplaced too", () => {
    const out = alloc([row("9", { location_id: A }), row("10", { location_id: B })], [wage("9", 200000), wage("10", 100000)], [B]);
    expect(out.rows).toEqual([{ location_id: B, salaried_cents: null, salaried_people: 1, unplaced_people: 1, missing_wage_people: 0 }]);
  });
});

describe("dates, corrections, two accounts", () => {
  it("a dated transfer: before it the old shop, from it the new one", () => {
    const rows = [row("9", { location_id: A, valid_from: "2026-07-19" }), row("9", { location_id: B, valid_from: "2026-10-11" })];
    expect(alloc(rows, [wage("9", 70000)], [A, B], "2026-10-04").rows.map((r) => r.salaried_cents)).toEqual([70000, null]);
    expect(alloc(rows, [wage("9", 70000)], [A, B], "2026-10-11").rows.map((r) => r.salaried_cents)).toEqual([null, 70000]);
  });
  it("a same-date correction: the newest seq wins (and a correction back cancels a transfer)", () => {
    const rows = [row("9", { location_id: A }), row("9", { location_id: B, valid_from: "2026-10-04" }), row("9", { location_id: A, valid_from: "2026-10-04" })];
    expect(payrollRowInForce(rows, "9", WEEK)!.location_id).toBe(A);
    expect(alloc(rows, [wage("9", 70000)]).rows.map((r) => r.salaried_cents)).toEqual([70000, null]);
  });
  it("a future row does not apply yet", () => {
    expect(payrollRowInForce([row("9", { valid_from: "2026-10-11" })], "9", WEEK)).toBeNull();
  });
  it("two 7shifts accounts of one human are two rows, each on its own", () => {
    const out = alloc([row("9", { location_id: A }), row("10", { disposition: "excluded", location_id: null })], [wage("9", 50000), wage("10", 60000)]);
    expect(out.rows.map((r) => r.salaried_cents)).toEqual([50000, null]);
  });
  it("is order-invariant", () => {
    const rows = [row("9", { location_id: A }), row("9", { location_id: B, valid_from: "2026-10-04" }), row("10", { location_id: B })];
    const wages = [wage("9", 1), wage("10", 2)];
    expect(alloc([...rows].reverse(), [...wages].reverse())).toEqual(alloc(rows, wages));
  });
});

const census = (o: Partial<CensusInput> = {}) => payrollCensus({
  weekStart: WEEK, storedShops: [A, B], accounts: [], wages: [], links: [], users: [], payrollShops: [], ...o,
});
const acct = (id: string, active = true) => ({ id, first_name: `F${id}`, last_name: `L${id}`, preferred_first_name: null, employee_id: `E${id}`, active });

describe("payrollCensus (Astra r2 P1): every 7shifts account is classified; nothing is silently missing", () => {
  it("an account with NO wage, NO punch, NO link and NO assignment is a 'needs a decision' gap", () => {
    const out = census({ accounts: [acct("77")] });
    expect(out.rows).toEqual([expect.objectContaining({ account: "77", chip: "needs_decision", gap: true, hasSalary: false, hasWage: false })]);
    expect(out.gapCount).toBe(1);
  });
  it("the same holds for an INACTIVE account (a former manager's history weeks)", () => {
    expect(census({ accounts: [acct("77", false)] }).rows[0]).toMatchObject({ chip: "needs_decision", gap: true });
  });
  it("an hourly account with no assignment is not a gap and not listed (counted only)", () => {
    const out = census({ accounts: [acct("5")], wages: [wage("5", 2000, { wage_type: "hourly" })] });
    expect(out.rows).toEqual([]);
    expect(out.hourlyHidden).toBe(1);
    expect(out.gapCount).toBe(0);
  });
  it("an hourly-wage account linked to a payroll-roster manager still needs a decision", () => {
    const out = census({ accounts: [acct("5")], wages: [wage("5", 2000, { wage_type: "hourly" })],
      links: [{ sevenshifts_user_id: "5", user_id: "u-gm", linked_at_location_id: A }], users: [{ id: "u-gm", name: "G", role: "gm", active: true }] });
    expect(out.rows[0]).toMatchObject({ chip: "needs_decision", gap: true, linkedUsers: [{ id: "u-gm", name: "G", role: "gm" }] });
  });
  it("salaried with no assignment: needs a payroll shop", () => {
    expect(census({ accounts: [acct("9")], wages: [wage("9", 1)] }).rows[0]).toMatchObject({ chip: "needs_shop", gap: true, hasSalary: true });
  });
  it("assigned + salaried = the shop; assigned + no salary = 'no salary in 7shifts' (a gap)", () => {
    const out = census({ accounts: [acct("9"), acct("10")], wages: [wage("9", 1)],
      payrollShops: [row("9", { location_id: A }), row("10", { location_id: B })] });
    expect(out.rows.map((r) => [r.account, r.chip, r.gap, r.locationId])).toEqual([["10", "no_salary", true, B], ["9", "shop", false, A]]);
  });
  it("assigned to a shop that is not linked any more: a gap whatever the wage", () => {
    const out = census({ accounts: [acct("9"), acct("10")], wages: [wage("9", 1)], storedShops: [B],
      payrollShops: [row("9", { location_id: A }), row("10", { location_id: A })] });
    expect(out.rows.map((r) => r.chip)).toEqual(["destination_unavailable", "destination_unavailable"]);
  });
  it("excluded: adjudicated, not a gap", () => {
    expect(census({ accounts: [acct("9")], payrollShops: [row("9", { disposition: "excluded", location_id: null })] }).rows[0])
      .toMatchObject({ chip: "excluded", gap: false });
  });
  it("a payroll-roster manager with no linked 7shifts account at all is named (the roster side of the census)", () => {
    const out = census({ users: [{ id: "u-own", name: "O", role: "owner", active: true }, { id: "u-cgs", name: "J", role: "cgs", active: true },
      { id: "u-emp", name: "E", role: "employee", active: true }, { id: "u-old", name: "X", role: "gm", active: false }] });
    expect(out.rosterNoAccount).toEqual([{ id: "u-own", name: "O", role: "owner" }]);
    expect(out.gapCount).toBe(1);
  });
  it("the roster is the level-6+ roles except the CGS (Juan 2026-11-17: the CGS is not salaried)", () => {
    expect([...PAYROLL_ROSTER_ROLES].sort()).toEqual(["agm", "catering_mgr", "gm", "moo", "owner", "prep_mgr", "social_media_mgr"]);
  });
  it("gaps come first; carries no wage amount anywhere", () => {
    const out = census({ accounts: [acct("9"), acct("77")], wages: [wage("9", 123456)], payrollShops: [row("9", { location_id: A })] });
    expect(out.rows.map((r) => r.account)).toEqual(["77", "9"]);
    expect(JSON.stringify(out)).not.toContain("123456");
  });
  it("history newest first with the newest seq, for the optimistic save", () => {
    const r1 = row("9", { location_id: A }), r2 = row("9", { location_id: B, valid_from: "2026-10-11" });
    const out = census({ accounts: [acct("9")], wages: [wage("9", 1)], payrollShops: [r1, r2] });
    expect(out.rows[0]!.newestSeq).toBe(r2.seq);
    expect(out.rows[0]!.history.map((h) => h.seq)).toEqual([r2.seq, r1.seq]);
  });
});
