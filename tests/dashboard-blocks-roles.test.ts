/**
 * Nav PR 8, T-R1 (plan r2 7.1, the pure half): the role blocks are decided by the REAL role only, never by a level, so the
 * strip is always Juan's (CGS) and never a GM's. "Needs you" is GM and up (a GM DOES get it, A8's correction). The page
 * half (a CGS with a key-holder "works as" row gets the strip at either selected shop) is in tests/dashboard-blocks-payload.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NEEDS_YOU_ROLES, NUMBERS_STRIP_ROLES, needsYouFor, numbersStripFor } from "@/lib/dashboard-blocks-shared";
import { ROLES, type RoleCode } from "@/lib/roles";

const ALL = Object.keys(ROLES) as RoleCode[];

describe("T-R1: by real role only", () => {
  it.each(ALL)("%s", (role) => {
    expect(numbersStripFor(role)).toBe(role === "moo" || role === "owner" || role === "cgs");
    expect(needsYouFor(role)).toBe(role === "gm" || role === "moo" || role === "owner" || role === "cgs");
  });

  it("no level test: a GM at level 10 gets no strip but gets Needs you; a CGS at level 4 gets the strip", () => {
    const gm10 = { role: "gm" as RoleCode, level: 10 };
    const cgs4 = { role: "cgs" as RoleCode, level: 4 };
    expect(numbersStripFor(gm10.role)).toBe(false);
    expect(needsYouFor(gm10.role)).toBe(true);
    expect(numbersStripFor(cgs4.role)).toBe(true);
    // The social media manager (level 6, like the catering manager) gets neither.
    expect(numbersStripFor("social_media_mgr")).toBe(false);
    expect(needsYouFor("social_media_mgr")).toBe(false);
  });

  it("the sets are exactly the spec's", () => {
    expect([...NUMBERS_STRIP_ROLES].sort()).toEqual(["cgs", "moo", "owner"]);
    expect([...NEEDS_YOU_ROLES].sort()).toEqual(["cgs", "gm", "moo", "owner"]);
  });

  it("the predicates read no level and no works-as (source pin)", () => {
    const src = readFileSync("lib/dashboard-blocks-shared.ts", "utf8");
    const body = (name: string) => src.slice(src.indexOf(`export function ${name}(`), src.indexOf("\n}\n", src.indexOf(`export function ${name}(`)));
    for (const fn of ["numbersStripFor", "needsYouFor"]) expect(body(fn)).not.toMatch(/level|works|acting/i);
  });
});
