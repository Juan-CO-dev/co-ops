// Item 2, payroll shop: every label of the card has en and es (operational tú), with the same {params}, and the
// list is the whole labor.payroll namespace (a new string cannot ship untranslated). Every refusal has its own message.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { PAYROLL_SHOP_ERROR_CODES, PAYROLL_SHOP_I18N_KEYS, PAYROLL_GAP_CHIPS } from "@/lib/facts/labor-payroll-shared";

const EN = en as Record<string, string>, ES = es as Record<string, string>;
const params = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!).sort();

it("every key has a non-empty en and es string with the same params, never usted", () => {
  for (const k of PAYROLL_SHOP_I18N_KEYS) {
    expect(EN[k], k).toBeTruthy();
    expect(ES[k], k).toBeTruthy();
    expect(params(ES[k]!), k).toEqual(params(EN[k]!));
    expect(ES[k]).not.toMatch(/\busted\b/i);
  }
});
it("the list is the whole labor.payroll namespace; every refusal and every chip has its own key", () => {
  expect(Object.keys(EN).filter((k) => k.startsWith("labor.payroll.")).sort()).toEqual([...PAYROLL_SHOP_I18N_KEYS].sort());
  for (const c of PAYROLL_SHOP_ERROR_CODES) expect(PAYROLL_SHOP_I18N_KEYS).toContain(`labor.payroll.error.${c}`);
  for (const c of [...PAYROLL_GAP_CHIPS, "shop", "excluded"]) expect(PAYROLL_SHOP_I18N_KEYS).toContain(`labor.payroll.chip.${c}`);
});
it("the card renders 44px controls with items-center and never a wage figure", () => {
  const src = readFileSync("components/admin/sevenshifts/PayrollShopCard.tsx", "utf8");
  expect(src).not.toMatch(/wage_cents|weekly_cents|salaried_cents/);
  for (const m of src.matchAll(/min-h-\[44px\][^"`]*/g)) expect(m[0], m[0]).toContain("items-center");
  expect(src).not.toMatch(/toLocale|\.slice\(0, 10\)/);
});
