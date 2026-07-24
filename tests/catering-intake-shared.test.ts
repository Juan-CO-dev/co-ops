/**
 * Unit spine — lib/catering/intake-shared.ts (lead-source registry). Pins the
 * registry codes (spec #2b), the validator, and the legacy free-text rule
 * (unknown values render verbatim, never crash, never translate).
 */
import { describe, it, expect } from "vitest";
import { LEAD_SOURCES, isLeadSource, leadSourceKey } from "@/lib/catering/intake-shared";

describe("lead source registry", () => {
  it("pins the spec #2b source codes", () => {
    expect([...LEAD_SOURCES]).toEqual([
      "portal", "staff", "phone", "walk_in", "toast_catering", "ezcater", "direct_invoice", "other",
    ]);
  });

  it("validates registry membership", () => {
    expect(isLeadSource("ezcater")).toBe(true);
    expect(isLeadSource("EzCater")).toBe(false); // codes are exact — UI sends codes, not labels
    expect(isLeadSource("instagram dm")).toBe(false);
  });

  it("legacy free-text values get no i18n key (render verbatim)", () => {
    expect(leadSourceKey("toast_catering")).toBe("catering.intake.source.toast_catering");
    expect(leadSourceKey("word of mouth")).toBeNull();
    expect(leadSourceKey(null)).toBeNull();
  });
});
