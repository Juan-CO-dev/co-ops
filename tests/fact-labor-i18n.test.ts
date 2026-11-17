// Item 2 PR 2c: every labor-fact label has en and es (operational tu), with the same {params}.
import { expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { LABOR_FACT_I18N_KEYS } from "@/lib/facts/labor-cost-shared";

const EN = en as Record<string, string>, ES = es as Record<string, string>;
const params = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!).sort();

it("every key has a non-empty en and es string with the same params", () => {
  for (const k of LABOR_FACT_I18N_KEYS) {
    expect(EN[k], k).toBeTruthy();
    expect(ES[k], k).toBeTruthy();
    expect(params(ES[k]!), k).toEqual(params(EN[k]!));
  }
});
it("the list is the whole labor.facts namespace, and the es copy never uses usted", () => {
  expect(Object.keys(EN).filter((k) => k.startsWith("labor.facts.")).sort()).toEqual([...LABOR_FACT_I18N_KEYS].sort());
  for (const k of LABOR_FACT_I18N_KEYS) expect(ES[k]).not.toMatch(/\busted\b/i);
});
