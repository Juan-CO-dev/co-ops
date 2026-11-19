// Board two labor views PR 2: every string of the burden card and of the hourly-target field has en and es
// (operational tú) with the same {params}; the list is the whole labor.burden namespace (a new string cannot ship
// untranslated); every refusal has its own message; the card keeps the 44px + items-center floor.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { LABOR_BURDEN_ERROR_CODES, LABOR_BURDEN_I18N_KEYS } from "@/lib/facts/labor-burden-shared";
import { HOURLY_TARGET_I18N_KEYS } from "@/lib/scheduling/settings-view-shared";

const EN = en as Record<string, string>, ES = es as Record<string, string>;
const params = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!).sort();

it("every key has a non-empty en and es string with the same params, never usted", () => {
  for (const k of [...LABOR_BURDEN_I18N_KEYS, ...HOURLY_TARGET_I18N_KEYS]) {
    expect(EN[k], k).toBeTruthy();
    expect(ES[k], k).toBeTruthy();
    expect(params(ES[k]!), k).toEqual(params(EN[k]!));
    expect(ES[k]).not.toMatch(/\busted\b/i);
  }
});
it("the list is the whole labor.burden namespace; every refusal has its own key", () => {
  expect(Object.keys(EN).filter((k) => k.startsWith("labor.burden.")).sort()).toEqual([...LABOR_BURDEN_I18N_KEYS].sort());
  expect(Object.keys(ES).filter((k) => k.startsWith("labor.burden.")).sort()).toEqual([...LABOR_BURDEN_I18N_KEYS].sort());
  for (const c of LABOR_BURDEN_ERROR_CODES) expect(LABOR_BURDEN_I18N_KEYS).toContain(`labor.burden.error.${c}`);
});
it("the burden is said to be an estimate until payroll gives the real figure, in both languages", () => {
  expect(EN["labor.burden.estimate_note"]).toMatch(/until payroll gives the real figure/);
  expect(ES["labor.burden.estimate_note"]).toMatch(/hasta que nómina dé la cifra real/);
  expect(EN["labor.burden.reprice_warning"]).toBe("This re-prices every week from {date}, including past weeks.");
});
it("the card renders 44px controls with items-center, every key it names exists, and it formats no date or number by locale", () => {
  const src = readFileSync("components/admin/sevenshifts/LaborBurdenCard.tsx", "utf8");
  for (const m of src.matchAll(/min-h-\[44px\][^"`]*/g)) expect(m[0], m[0]).toContain("items-center");
  expect(src).not.toMatch(/toLocale|\.slice\(0, 10\)|toFixed/);
  for (const m of src.matchAll(/"(labor\.burden\.[a-z_.]+)"/g)) expect(LABOR_BURDEN_I18N_KEYS as readonly string[], m[1]).toContain(m[1]!);
  for (const m of src.matchAll(/`labor\.burden\.([a-z_]+)\.\$\{/g)) expect(LABOR_BURDEN_I18N_KEYS.some((k) => k.startsWith(`labor.burden.${m[1]}.`)), m[1]).toBe(true);
});
