// Board two labor views PR 2: the burden card's pure rules (lib/facts/labor-burden-shared.ts). The resolution is
// the TS twin of 0346's fact_labor_burden_for (compared against the real SQL in the migration test's own data here
// by hand-built rows; the SQL side is tests/labor-burden-0346-migration.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  burdenCardView, burdenFor, canFollowCompanyOn, canManageLaborBurden, parseBurdenSave, type BurdenRow,
} from "@/lib/facts/labor-burden-shared";
import { ROLES, type RoleCode } from "@/lib/roles";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let n = 0;
const row = (o: Partial<BurdenRow> & { valid_from: string }): BurdenRow => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, location_id: null, burden_pct: 10, source: "payroll", follows_company: false,
  created_at: `2026-11-18T12:00:${String(n).padStart(2, "0")}.000000+00:00`, created_by: "u1", has_note: false, ...o });
const follow = (loc: string, valid_from: string) => row({ location_id: loc, valid_from, follows_company: true, burden_pct: null, source: null });

describe("who", () => {
  it("only the owner, the CGS and the MoO, by role", () => {
    const allowed = (Object.keys(ROLES) as RoleCode[]).filter(canManageLaborBurden).sort();
    expect(allowed).toEqual(["cgs", "moo", "owner"]);
  });
});

describe("burdenFor: the shop's rate in force, else the company's, else 12% estimated", () => {
  const rows = [
    row({ valid_from: "2026-07-19", burden_pct: 10 }), row({ valid_from: "2026-09-06", burden_pct: 11 }),
    row({ location_id: B, valid_from: "2026-08-02", burden_pct: 15.5, source: "estimated" }),
    follow(B, "2026-10-04"),
    row({ location_id: B, valid_from: "2026-11-08", burden_pct: 9 }),
  ];
  it("no row at all is the default", () => {
    expect(burdenFor([], A, "2026-10-04")).toEqual({ pct: 12, basis: "estimated", scope: "default" });
    expect(burdenFor(rows, A, "2026-07-12")).toEqual({ pct: 12, basis: "estimated", scope: "default" });
  });
  it("a shop with no row reads the company row in force at that week", () => {
    expect(burdenFor(rows, A, "2026-08-30")).toEqual({ pct: 10, basis: "payroll", scope: "company" });
    expect(burdenFor(rows, A, "2026-09-06")).toEqual({ pct: 11, basis: "payroll", scope: "company" });
  });
  it("a shop's own rate wins from its date; a follow row ends it from its date; a later rate starts again", () => {
    expect(burdenFor(rows, B, "2026-07-26")).toMatchObject({ pct: 10, scope: "company" });
    expect(burdenFor(rows, B, "2026-09-27")).toEqual({ pct: 15.5, basis: "estimated", scope: "shop" });
    expect(burdenFor(rows, B, "2026-10-04")).toEqual({ pct: 11, basis: "payroll", scope: "company" });
    expect(burdenFor(rows, B, "2026-11-01")).toMatchObject({ pct: 11, scope: "company" });
    expect(burdenFor(rows, B, "2026-11-08")).toEqual({ pct: 9, basis: "payroll", scope: "shop" });
  });
  it("two rows for one date: the newer one wins", () => {
    const two = [row({ location_id: A, valid_from: "2026-10-04", burden_pct: 13 }), row({ location_id: A, valid_from: "2026-10-04", burden_pct: 13.25 })];
    expect(burdenFor(two, A, "2026-10-04").pct).toBe(13.25);
    expect(burdenFor([...two].reverse(), A, "2026-10-04").pct).toBe(13.25);
  });
});

describe("burdenCardView", () => {
  const rows = [
    row({ valid_from: "2026-07-19", burden_pct: 10 }),
    row({ location_id: B, valid_from: "2026-08-02", burden_pct: 15.5, source: "estimated" }),
    row({ location_id: B, valid_from: "2026-12-06", burden_pct: 16 }),
  ];
  const view = burdenCardView(rows, [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }], "2026-11-15");
  it("the company scope first, then every shop, each with what it reads this week and the head to send back", () => {
    expect(view.weekStart).toBe("2026-11-15");
    expect(view.scopes.map((s) => [s.locationId, s.name, s.pct, s.basis, s.scope])).toEqual([
      [null, null, 10, "payroll", "company"], [A, "Shop A", 10, "payroll", "company"], [B, "Shop B", 15.5, "estimated", "shop"]]);
    expect(view.scopes[0]!.headId).toBe(rows[0]!.id);
    expect(view.scopes[1]!.headId).toBeNull();
    expect(view.scopes[2]!.headId).toBe(rows[2]!.id); // the NEWEST row of the scope, in force or not
  });
  it("the mode selector is offered to a shop that has ever had its own rate; history is newest first; a later start is 'scheduled'", () => {
    expect(view.scopes.map((s) => s.hasOwnRate)).toEqual([false, false, true]);
    expect(view.scopes[2]!.history.map((h) => [h.validFrom, h.pct, h.followsCompany, h.scheduled])).toEqual([["2026-12-06", 16, false, true], ["2026-08-02", 15.5, false, false]]);
    expect(view.estimatedCount).toBe(1);
  });
});

describe("canFollowCompanyOn: judged at the SELECTED start, never this week (review BOARD2-r1 P2)", () => {
  it("a future override, scheduled while the shop follows the company this week, can be cancelled before it starts", () => {
    const rows = [row({ valid_from: "2026-07-19", burden_pct: 10 }), row({ location_id: B, valid_from: "2026-11-22", burden_pct: 14 })];
    const shop = burdenCardView(rows, [{ id: B, name: "Shop B" }], "2026-11-15").scopes[1]!;
    expect(shop.scope).toBe("company"); // this week it follows the company
    expect(shop.hasOwnRate).toBe(true); // so the selector must still be offered
    expect(canFollowCompanyOn(shop.history, "2026-11-22")).toBe(true);
    expect(canFollowCompanyOn(shop.history, "2026-12-06")).toBe(true);
    expect(canFollowCompanyOn(shop.history, "2026-11-15")).toBe(false); // nothing of its own in force yet
  });
  it("a shop back on the company rate can backdate the return into an earlier override period", () => {
    const rows = [row({ valid_from: "2026-07-19", burden_pct: 10 }), row({ location_id: B, valid_from: "2026-08-02", burden_pct: 15.5, source: "estimated" }),
      follow(B, "2026-10-04")];
    const shop = burdenCardView(rows, [{ id: B, name: "Shop B" }], "2026-11-15").scopes[1]!;
    expect(shop.scope).toBe("company");
    expect(canFollowCompanyOn(shop.history, "2026-09-06")).toBe(true);  // inside the override: a correction
    expect(canFollowCompanyOn(shop.history, "2026-10-11")).toBe(false); // already following then
    expect(canFollowCompanyOn(shop.history, "2026-07-26")).toBe(false); // before the shop's own rate
  });
  it("same-date rows: the newer one decides, whatever order the history arrives in", () => {
    const rows = [row({ location_id: B, valid_from: "2026-10-04", burden_pct: 13 }), follow(B, "2026-10-04")];
    const h = burdenCardView(rows, [{ id: B, name: "Shop B" }], "2026-11-15").scopes[1]!.history;
    expect(canFollowCompanyOn(h, "2026-10-04")).toBe(false);
    expect(canFollowCompanyOn([...h].reverse(), "2026-10-04")).toBe(false);
  });
  it("the card judges the date in its own Starts field (source pin)", () => {
    const src = readFileSync(join(process.cwd(), "components/admin/sevenshifts/LaborBurdenCard.tsx"), "utf8");
    expect(src).toContain("canFollowCompanyOn(scope.history, starts)");
    expect(src).not.toMatch(/scope\.canFollowCompany\b/);
  });
  it("with nothing saved every scope is the 12% estimate", () => {
    const empty = burdenCardView([], [{ id: A, name: "Shop A" }], "2026-11-15");
    expect(empty.scopes.map((s) => [s.pct, s.basis, s.scope, s.headId])).toEqual([[12, "estimated", "default", null], [12, "estimated", "default", null]]);
    expect(empty.estimatedCount).toBe(2);
  });
});

describe("parseBurdenSave: the exact request body", () => {
  const ok = { locationId: null, followCompany: false, burdenPct: 11.5, validFrom: "2026-07-19", source: "payroll", note: "", expectedId: null };
  it("a rate for the company or a shop; follow the company for a shop", () => {
    expect(parseBurdenSave(ok)).toEqual(ok);
    expect(parseBurdenSave({ ...ok, locationId: A.toUpperCase(), expectedId: B })).toMatchObject({ locationId: A, expectedId: B });
    expect(parseBurdenSave({ ...ok, locationId: A, followCompany: true, burdenPct: null, source: null })).toMatchObject({ followCompany: true, burdenPct: null, source: null });
  });
  it("refuses anything else", () => {
    const bad: unknown[] = [null, [], "x", { ...ok, extra: 1 }, { ...ok, burdenPct: "11" }, { ...ok, burdenPct: 51 }, { ...ok, burdenPct: -1 }, { ...ok, burdenPct: Number.NaN },
      { ...ok, validFrom: "2026-07-20" }, { ...ok, validFrom: "2026-07-12" }, { ...ok, validFrom: "07/19/2026" }, { ...ok, source: "guess" }, { ...ok, source: null },
      { ...ok, burdenPct: null }, { ...ok, note: 5 }, { ...ok, note: "x".repeat(501) }, { ...ok, locationId: "all" }, { ...ok, expectedId: "7" }, { ...ok, followCompany: "yes" },
      { ...ok, followCompany: true, burdenPct: null, source: null }, // the company cannot follow itself
      { ...ok, locationId: A, followCompany: true }, { ...ok, locationId: A, followCompany: true, burdenPct: null },
      (({ note: _n, ...rest }) => rest)(ok)];
    for (const b of bad) expect(parseBurdenSave(b), JSON.stringify(b)).toBeNull();
  });
});
