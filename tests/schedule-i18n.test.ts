/**
 * Scheduling Phase 2, Task 15 — the audit vocabulary and the i18n scaffolding for every code. Every ScheduleErrorCode,
 * every RULE_CODES entry, every gap cause and certificate line, every structure rule, every reason key the generator
 * can emit (the closed REASON_KEYS union), every board note, every labor / budget / "What changed" line and every
 * board label has an en AND an es string; the es copy is operational tú (never usted); every {param} in the en string
 * appears in the es string. The schedule.* audit actions are registered and adjudicated.
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { DESTRUCTIVE_ACTIONS } from "@/lib/destructive-actions";
import { NON_DESTRUCTIVE_ACTIONS } from "@/lib/audit-actions";
import { scheduleI18nKeys, STRUCTURE_RULE_KEYS } from "@/lib/scheduling/i18n-keys-shared";
import { GAP_CAUSES } from "@/lib/scheduling/shapes-shared";
import { PROVEN_CAUSE_ORDER, RULE_CODES } from "@/lib/scheduling/rules-shared";
import { NOTE_CODES, REASON_KEYS } from "@/lib/scheduling/reasons-shared";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;
const families = scheduleI18nKeys();
const all = Object.values(families).flat();
const params = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!).sort();

describe("every scheduling key has an en and an es string", () => {
  it.each(Object.entries(families))("%s: en + es present and non-empty", (_family, keys) => {
    const missing = keys.filter((k) => !EN[k] || !ES[k]);
    expect(missing).toEqual([]);
  });

  it("the families are complete: every union member is listed", () => {
    expect(families.rule).toHaveLength(Object.keys(RULE_CODES).length);
    expect(families.reason).toHaveLength(REASON_KEYS.length + 1);
    expect(families.note).toHaveLength(NOTE_CODES.length);
    expect([...GAP_CAUSES].sort()).toEqual([...PROVEN_CAUSE_ORDER, "unresolved_search"].sort());
    expect(families.certificate).toHaveLength(GAP_CAUSES.length);
    expect(families.structure).toHaveLength(STRUCTURE_RULE_KEYS.length);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(200);
  });

  it("es is operational tú — never usted, never su", () => {
    const formal = all.filter((k) => /\busted(es)?\b|\bsu\s|\bsus\s/i.test(ES[k] ?? ""));
    expect(formal).toEqual([]);
  });

  it("every {param} of the en string is in the es string (and nothing extra)", () => {
    const off = all.filter((k) => EN[k] && ES[k] && params(EN[k]!).join(",") !== params(ES[k]!).join(","));
    expect(off).toEqual([]);
  });

  it("the new chunk D strings are real translations", () => {
    for (const k of ["schedule.error.invalid_payload", "schedule.error.roster_include_refused", "schedule.error.gap_certificate_invalid",
      "schedule.gap.structure.max_shift", "schedule.note.essential_past_budget", "schedule.diff.kind.cost_unknown"]) {
      expect(ES[k], k).not.toBe(EN[k]);
    }
  });
});

describe("the schedule audit vocabulary (Task 15)", () => {
  it("the destructive acts: a human changing shared config or the record", () => {
    for (const a of ["schedule.structure_update", "schedule.shop_settings_update", "schedule.person_settings_update", "schedule.budget_set",
      "schedule.regenerate_overwrite", "schedule.week_approve", "schedule.pin_set", "schedule.day_type_set"]) {
      expect(DESTRUCTIVE_ACTIONS as readonly string[], a).toContain(a);
      expect(NON_DESTRUCTIVE_ACTIONS as readonly string[], a).not.toContain(a);
    }
  });

  it("the non-destructive acts: proposals, a kept suggestion, system observations", () => {
    for (const a of ["schedule.generate", "schedule.regenerate", "schedule.edit", "schedule.budget_kept", "schedule.draft_auto", "schedule.draft_skipped",
      "schedule.generator_invalid"]) {
      expect(NON_DESTRUCTIVE_ACTIONS as readonly string[], a).toContain(a);
      expect(DESTRUCTIVE_ACTIONS as readonly string[], a).not.toContain(a);
    }
  });
});
