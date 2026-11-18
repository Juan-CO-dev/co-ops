// Item 9 PR 9a: every business-report label has en and es (operational tú) with the same {params}, and every
// non-ok labor state the pure core can return has its line (so 9b never shows a raw code).
import { expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { BUSINESS_REPORT_I18N_KEYS } from "@/lib/business-report-shared";

const EN = en as Record<string, string>, ES = es as Record<string, string>;
const params = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!).sort();

it("every key has a non-empty en and es string with the same params, never usted", () => {
  for (const k of BUSINESS_REPORT_I18N_KEYS) {
    expect(EN[k], k).toBeTruthy();
    expect(ES[k], k).toBeTruthy();
    expect(params(ES[k]!), k).toEqual(params(EN[k]!));
    expect(ES[k]).not.toMatch(/\busted\b/i);
  }
});
it("the list is the whole reports.business namespace and covers every labor state", () => {
  expect(Object.keys(EN).filter((k) => k.startsWith("reports.business.")).sort()).toEqual([...BUSINESS_REPORT_I18N_KEYS].sort());
  for (const s of ["rebuilding", "unbuilt", "before_history", "hours_unknown", "sales_not_covered", "net_unknown", "ezcater_missing", "zero_sales"]) {
    expect(BUSINESS_REPORT_I18N_KEYS).toContain(`reports.business.labor.state.${s}`);
  }
});
