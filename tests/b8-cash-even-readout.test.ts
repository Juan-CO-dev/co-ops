import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { overShortReadout } from "@/lib/cash-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

// B8 #6 (sim walk 2026-10-14): the submitted cash view said "$0.00 over" on an even night
// while the entry form said "Even". Both now read one rule.

describe("B8 #6 over/short wording", () => {
  it("zero is Even, never over", () => {
    expect(overShortReadout(0)).toEqual({ key: "cash.readout.even", amountCents: 0 });
  });
  it("positive is over, negative is short, amount is the magnitude", () => {
    expect(overShortReadout(125)).toEqual({ key: "cash.readout.over", amountCents: 125 });
    expect(overShortReadout(-300)).toEqual({ key: "cash.readout.short", amountCents: 300 });
  });
  it("the form and the submitted view both use it (no hand-rolled >= 0 → over)", () => {
    const page = readFileSync("app/(authed)/cash/page.tsx", "utf8");
    const client = readFileSync("app/(authed)/cash/cash-client.tsx", "utf8");
    expect(page).toContain("overShortReadout(report.overShortCents).key");
    expect(page).not.toMatch(/overShortCents >= 0/);
    expect(client).toContain("overShortReadout(overShortCents)");
  });
  it("Even exists in both dictionaries", () => {
    expect(en["cash.readout.even"]).toBe("Even");
    expect(es["cash.readout.even"]).toBeTruthy();
  });
});
