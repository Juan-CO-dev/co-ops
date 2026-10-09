/**
 * Mid-shift Pulse v2 — the role matrix (spec "Role scoping", enforced server-side; never hide-only).
 * One function decides for the page, every section page and the API, so a drill link can never
 * widen scope. Crew (<4): no money, no other people's details.
 */
import { describe, expect, it } from "vitest";
import {
  PULSE_SECTIONS,
  PULSE_V2_BASE_LEVEL,
  BOTH_SHOPS_LEVEL,
  canViewSection,
  crewScoped,
  moneyVisible,
  canAuthorHandoff,
  canArrangeFloor,
  visibleSections,
  pulsePageAccess,
  sectionAccess,
} from "@/lib/pulse/scope-shared";
import { pulseV2Enabled } from "@/lib/pulse/flag";

describe("PULSE_V2 flag", () => {
  it("is off unless PULSE_V2=1 exactly", () => {
    const prior = process.env.PULSE_V2;
    delete process.env.PULSE_V2;
    expect(pulseV2Enabled()).toBe(false);
    process.env.PULSE_V2 = "true";
    expect(pulseV2Enabled()).toBe(false);
    process.env.PULSE_V2 = "1";
    expect(pulseV2Enabled()).toBe(true);
    if (prior === undefined) delete process.env.PULSE_V2; else process.env.PULSE_V2 = prior;
  });
});

describe("section matrix", () => {
  const crewOnly = ["attention", "floor", "stations", "food_safety", "handoff"];
  it.each([2, 3])("crew level %i sees shop status, own work and handoff — never people, money, inventory", (level) => {
    expect(visibleSections(level)).toEqual(crewOnly);
    expect(canViewSection(level, "people")).toBe(false);
    expect(canViewSection(level, "sales")).toBe(false);
    expect(canViewSection(level, "catering")).toBe(false);
    expect(canViewSection(level, "inventory")).toBe(false);
    expect(crewScoped(level)).toBe(true);
    expect(moneyVisible(level)).toBe(false);
  });
  it.each([4, 5])("KH/SL level %i adds people, catering, inventory — still no money", (level) => {
    for (const s of ["attention", "floor", "people", "stations", "catering", "inventory", "food_safety", "handoff"]) {
      expect(canViewSection(level, s as never)).toBe(true);
    }
    expect(canViewSection(level, "sales")).toBe(false);
    expect(crewScoped(level)).toBe(false);
    expect(moneyVisible(level)).toBe(false);
    expect(canAuthorHandoff(level)).toBe(false);
  });
  it("AGM (6) authors + acks handoff, still no sales", () => {
    expect(canAuthorHandoff(6)).toBe(true);
    expect(canViewSection(6, "sales")).toBe(false);
    expect(moneyVisible(6)).toBe(false);
  });
  it("GM (7) sees sales/money and may arrange the floor", () => {
    expect(canViewSection(7, "sales")).toBe(true);
    expect(moneyVisible(7)).toBe(true);
    expect(canArrangeFloor(7)).toBe(true);
    expect(canArrangeFloor(6)).toBe(false);
    expect(visibleSections(7)).toEqual([...PULSE_SECTIONS]);
  });
  it("8+ sees everything and both shops side by side", () => {
    expect(visibleSections(8)).toEqual([...PULSE_SECTIONS]);
    expect(BOTH_SHOPS_LEVEL).toBe(8);
  });
  it("the attention list is first in the canonical order (needs attention loads first)", () => {
    expect(PULSE_SECTIONS[0]).toBe("attention");
    expect(PULSE_SECTIONS[1]).toBe("floor");
  });
});

describe("pulsePageAccess / sectionAccess", () => {
  it("flag off → v1 for everyone (byte-identical legacy behaviour decided by the page)", () => {
    expect(pulsePageAccess({ flagOn: false, level: 3 })).toBe("v1");
    expect(pulsePageAccess({ flagOn: false, level: 9 })).toBe("v1");
  });
  it("flag on → denied below the v2 floor, v2 otherwise, both-shops at 8+", () => {
    expect(PULSE_V2_BASE_LEVEL).toBe(2);
    expect(pulsePageAccess({ flagOn: true, level: 1 })).toBe("denied");
    expect(pulsePageAccess({ flagOn: true, level: 2 })).toBe("v2");
    expect(pulsePageAccess({ flagOn: true, level: 7 })).toBe("v2");
    expect(pulsePageAccess({ flagOn: true, level: 8 })).toBe("v2_both");
  });
  it("a section page is 404 when the flag is off, denied when out of scope, ok otherwise", () => {
    expect(sectionAccess({ flagOn: false, level: 9, section: "sales" })).toBe("not_found");
    expect(sectionAccess({ flagOn: true, level: 3, section: "sales" })).toBe("denied");
    expect(sectionAccess({ flagOn: true, level: 3, section: "people" })).toBe("denied");
    expect(sectionAccess({ flagOn: true, level: 1, section: "attention" })).toBe("denied");
    expect(sectionAccess({ flagOn: true, level: 3, section: "stations" })).toBe("ok");
    expect(sectionAccess({ flagOn: true, level: 7, section: "sales" })).toBe("ok");
    expect(sectionAccess({ flagOn: true, level: 7, section: "nope" as never })).toBe("not_found");
  });
});
