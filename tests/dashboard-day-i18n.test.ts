/**
 * Nav PR 7 (plan r2 section 6, T15): the Dashboard's new keys ship in English and Spanish together, non-empty, with the
 * same {params}, in operational tú-form. No new day.* key (tests/day-plan-i18n.test.ts pins PR 5's list as every day.* key).
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

const DASHBOARD_DAY_KEYS = [
  "dashboard.greeting.morning", "dashboard.greeting.afternoon", "dashboard.greeting.evening",
  "dashboard.day.phase_aria", "dashboard.day.list_aria", "dashboard.day.next_up", "dashboard.day.nothing_due_none",
  "dashboard.day.done_heading", "dashboard.day.tools_heading", "dashboard.day.band.urgent", "dashboard.day.band.now",
  "dashboard.day.action.do", "dashboard.day.action.do_aria", "dashboard.day.action.assign", "dashboard.day.action.assign_aria",
  "dashboard.day.action.edit", "dashboard.day.action.edit_aria", "dashboard.day.holder_unknown",
  "dashboard.shortcuts.heading", "dashboard.shortcuts.all_pages", "dashboard.shortcuts.aria",
  "dashboard.smm.tasks_heading", "dashboard.smm.no_tasks",
] as const;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("the Dashboard's day keys (section 6)", () => {
  it("23 keys, no duplicate, and every dashboard.day / greeting / shortcuts / smm key is one of them", () => {
    expect(DASHBOARD_DAY_KEYS).toHaveLength(23);
    expect(new Set(DASHBOARD_DAY_KEYS).size).toBe(23);
    const family = (d: Record<string, string>) => Object.keys(d).filter((k) => /^dashboard\.(day|greeting|shortcuts|smm)\./.test(k)).sort();
    expect(family(EN)).toEqual([...DASHBOARD_DAY_KEYS].sort());
    expect(family(ES)).toEqual([...DASHBOARD_DAY_KEYS].sort());
  });

  it.each(DASHBOARD_DAY_KEYS)("%s: present in both, non-empty, the same {params}", (k) => {
    expect(EN[k]?.trim(), k).toBeTruthy();
    expect(ES[k]?.trim(), k).toBeTruthy();
    expect(placeholders(ES[k]!), k).toEqual(placeholders(EN[k]!));
  });

  it("the greetings and the action ARIA labels carry their params", () => {
    for (const k of ["dashboard.greeting.morning", "dashboard.greeting.afternoon", "dashboard.greeting.evening"]) expect(placeholders(EN[k]!)).toEqual(["name"]);
    for (const k of ["dashboard.day.action.do_aria", "dashboard.day.action.assign_aria", "dashboard.day.action.edit_aria"]) expect(placeholders(EN[k]!)).toEqual(["task"]);
  });

  it("Spanish is tú-form: no usted, no formal imperatives (the day-plan i18n test's rules)", () => {
    for (const k of DASHBOARD_DAY_KEYS) {
      expect(ES[k], k).not.toMatch(/\busted(es)?\b/i);
      expect(ES[k], k).not.toMatch(/\b(Llene|Pida|Registre|Haga|Cuente|Termine|Asigne|Edite)\b/);
    }
    expect(ES["dashboard.day.action.do"]).toBe("Hazlo");
    expect(ES["dashboard.day.action.assign_aria"]).toMatch(/^Asigna /);
    expect(ES["dashboard.day.action.edit_aria"]).toMatch(/^Edita tu /);
  });

  it("adds no day.* key", () => {
    expect(DASHBOARD_DAY_KEYS.some((k) => k.startsWith("day."))).toBe(false);
  });
});
