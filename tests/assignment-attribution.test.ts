import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { formatAssignmentAttribution, requiresOverrideReason, validOverrideReason } from "@/lib/assignments-shared";

describe("assignment attribution and reasons", () => {
  it.each(["assigned", "taken", "claimed"] as const)("formats %s with Eastern time and names", (source) => {
    const seen = { key: "", params: {} as Record<string, unknown> };
    formatAssignmentAttribution({ source, holderName: "Ana", actorName: "Bea", at: "2026-10-08T16:03:00Z" }, "en", (key, params) => {
      seen.key = key; seen.params = params ?? {}; return key;
    });
    expect(seen).toEqual({ key: `assignments.attribution.${source}`, params: { name: "Ana", by: "Bea", time: "12:03 PM" } });
    expect(formatAssignmentAttribution(null, "es", (key) => key)).toBe("assignments.unassigned");
  });
  it.each([[4, 7, true], [7, 7, false], [7, 4, false], [4, null, false]] as const)("reason hierarchy %s/%s", (actor, assigner, expected) => {
    expect(requiresOverrideReason(actor!, assigner)).toBe(expected);
  });
  it("validates code, other text and a 500 character Unicode boundary", () => {
    expect(validOverrideReason(null, null)).toBe(true);
    expect(validOverrideReason("coverage_change", null)).toBe(true);
    expect(validOverrideReason("other", "  ")).toBe(false);
    expect(validOverrideReason("other", "x".repeat(500))).toBe(true);
    expect(validOverrideReason("other", "😀".repeat(500))).toBe(true);
    expect(validOverrideReason("other", "x".repeat(501))).toBe(false);
    expect(validOverrideReason("invented", "valid note")).toBe(false);
    expect(validOverrideReason(null, 123)).toBe(false);
  });
  it("keeps all assignment keys and placeholders in Spanish", () => {
    const keys = Object.keys(en).filter((key) => key.startsWith("assignments."));
    expect(keys.length).toBeGreaterThan(20);
    expect(Object.keys(es).filter((key) => key.startsWith("assignments.")).sort()).toEqual(keys.sort());
    const placeholders = (value: string) => [...value.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
    for (const key of keys) {
      expect((es as Record<string, string>)[key], key).toBeTruthy();
      expect(placeholders((es as Record<string, string>)[key]!)).toEqual(placeholders((en as Record<string, string>)[key]!));
    }
  });
});
