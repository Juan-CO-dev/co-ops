/** en/es parity for every Mid-shift Pulse v2 string (translate-from-day-one law). */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { PULSE_SECTIONS } from "@/lib/pulse/scope-shared";
import { ATTENTION_ORDER } from "@/lib/pulse/attention-shared";

const enKeys = Object.keys(en).filter((k) => k.startsWith("pulse."));
const esKeys = Object.keys(es).filter((k) => k.startsWith("pulse."));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("pulse.* i18n", () => {
  it("every en key has an es key and vice versa", () => {
    expect(esKeys.sort()).toEqual(enKeys.sort());
    expect(enKeys.length).toBeGreaterThan(150);
  });
  it("placeholders match and no string is empty", () => {
    for (const k of enKeys) {
      const a = (en as Record<string, string>)[k]!;
      const b = (es as Record<string, string>)[k]!;
      expect(a.trim().length, k).toBeGreaterThan(0);
      expect(b.trim().length, k).toBeGreaterThan(0);
      expect(placeholders(b), k).toEqual(placeholders(a));
    }
  });
  it("every section, status and attention kind/action has its label", () => {
    const has = (k: string) => expect(k in en, k).toBe(true);
    for (const s of PULSE_SECTIONS) has(`pulse.section.${s}`);
    for (const s of ["covered", "short", "closing_soon", "uncovered", "closed", "inactive"]) has(`pulse.status.${s}`);
    for (const k of ATTENTION_ORDER) {
      if (["fridge_unchecked", "item_low", "clockin_unlinked"].includes(k)) { has(`pulse.attention.${k}_one`); has(`pulse.attention.${k}_other`); }
      else has(`pulse.attention.${k}`);
    }
    for (const a of ["assign", "trim", "close", "open", "check", "order", "ring", "prep", "link"]) has(`pulse.attention.action.${a}`);
    for (const a of ["crew", "managers", "all"]) has(`pulse.handoff.audience.${a}`);
    for (const k of ["clock_in", "clock_out", "end_shift", "station", "release", "break_start", "break_end"]) has(`pulse.people.event.${k}`);
    for (const k of ["upcoming", "due", "overdue", "opening_unknown"]) has(`pulse.catering.timing.${k}`);
  });
});
