// Item 2 PR 2c (plan r6 §2, Step 2 + Q5): the PURE rate pick over the one-version-per-wage candidates
// that 0338's fact_wage_current_versions returns (Step 1, supersession, is proven on the real
// reconciler in tests/fact-labor-0338-harness.test.ts).
import { describe, expect, it } from "vitest";
import { pickWage, type WageVersion } from "@/lib/facts/labor-wages-shared";

let seq = 0;
const v = (o: Partial<WageVersion>): WageVersion => ({ user_id: "7", wage_id: String(++seq), upcoming: false, effective_date: "2026-08-01",
  wage_type: "hourly", wage_cents: 2000, role_id: null, active: true, seq: ++seq, ...o });

describe("pickWage: role, then date, then current-before-upcoming, then seq", () => {
  it("no candidate at all = none, priced later at the estimate", () => {
    expect(pickWage([], "0", "2026-08-10")).toEqual({ basis: "none", rate: null, carryBack: null, payClass: "hourly" });
  });
  it("the greatest effective_date on or before the day wins", () => {
    const a = v({ effective_date: "2026-07-01", wage_cents: 1800 }), b = v({ effective_date: "2026-08-01", wage_cents: 2000 }),
      c = v({ effective_date: "2026-09-01", wage_cents: 2200 });
    expect(pickWage([a, b, c], "0", "2026-08-15")).toMatchObject({ basis: "known", rate: b });
    expect(pickWage([a, b, c], "0", "2026-09-01")).toMatchObject({ basis: "known", rate: c });
  });
  it("a matching role beats a null role, a null role beats any other role", () => {
    const r1 = v({ role_id: "11", wage_cents: 2400 }), none = v({ role_id: null, wage_cents: 1900 }), r2 = v({ role_id: "12", wage_cents: 2600 });
    expect(pickWage([r1, none, r2], "11", "2026-08-15").rate).toBe(r1);
    expect(pickWage([r1, none, r2], "13", "2026-08-15").rate).toBe(none);
    expect(pickWage([r1, r2], "13", "2026-08-15").rate?.wage_cents).toBeDefined();
    expect(pickWage([r1, none], "0", "2026-08-15").rate).toBe(none);
  });
  it("a role match dated in the future falls to an eligible lower tier, never to a future wage", () => {
    const future = v({ role_id: "11", effective_date: "2026-09-01", wage_cents: 2400 }), base = v({ role_id: null, effective_date: "2026-07-01", wage_cents: 1900 });
    expect(pickWage([future, base], "11", "2026-08-15")).toMatchObject({ basis: "known", rate: base });
  });
  it("on a date tie, the current version beats the upcoming one, then the greater seq", () => {
    const up = v({ upcoming: true, wage_cents: 2100, seq: 900 }), cur = v({ upcoming: false, wage_cents: 2000, seq: 100 });
    expect(pickWage([up, cur], "0", "2026-08-15").rate).toBe(cur);
    const older = v({ wage_cents: 1, seq: 5 }), newer = v({ wage_cents: 2, seq: 6 });
    expect(pickWage([older, newer], "0", "2026-08-15").rate).toBe(newer);
  });
  it("an undated version ranks below every dated one and is flagged undated", () => {
    const und = v({ effective_date: null, wage_cents: 3000 }), dated = v({ effective_date: "2026-08-01", wage_cents: 2000 });
    expect(pickWage([und, dated], "0", "2026-08-15")).toMatchObject({ basis: "known", rate: dated });
    expect(pickWage([und], "0", "2026-08-15")).toMatchObject({ basis: "undated", rate: und, carryBack: null });
  });
  it("before the first known wage: before_first_known, carrying the first known wage back (Q5)", () => {
    const sep = v({ effective_date: "2026-09-01", wage_cents: 2500 }), oct = v({ effective_date: "2026-10-01", wage_cents: 2700 });
    expect(pickWage([oct, sep], "0", "2026-08-15")).toEqual({ basis: "before_first_known", rate: null, carryBack: sep, payClass: "hourly" });
  });
  it("the carry-back prefers the matching role, then the smallest date, current first, then the greatest seq", () => {
    const anyEarly = v({ role_id: "12", effective_date: "2026-09-01", wage_cents: 1 }), mine = v({ role_id: "11", effective_date: "2026-10-01", wage_cents: 2 });
    expect(pickWage([anyEarly, mine], "11", "2026-08-15").carryBack).toBe(mine);
    const up = v({ upcoming: true, effective_date: "2026-09-01", seq: 50, wage_cents: 3 }), cur = v({ effective_date: "2026-09-01", seq: 10, wage_cents: 4 });
    expect(pickWage([up, cur], "0", "2026-08-15").carryBack).toBe(cur);
  });
  it("salaried wages make a salaried row (never priced hourly, never overtime)", () => {
    const sal = v({ wage_type: "weekly_salary", wage_cents: 120000 });
    expect(pickWage([sal], "0", "2026-08-15")).toMatchObject({ basis: "known", payClass: "salaried" });
    const later = v({ wage_type: "annual_salary", effective_date: "2026-09-01" });
    expect(pickWage([later], "0", "2026-08-15")).toMatchObject({ basis: "before_first_known", payClass: "salaried" });
  });
});
