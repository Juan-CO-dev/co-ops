/**
 * CC chunk H9 fix 5 (2026-10-17, P3) — the strip said "{name}: 40 h + 10 h flex used (keeps hourly labor down)" beside "hourly
 * hours saved: 0 h" when the flex had gone to manager-on-duty time. It now says what the flex covered: STATION time (and how much
 * hourly time that saved) vs manager-on-duty time — never a saving that reads as 0. en + es.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { moneyStrip } from "@/lib/scheduling/board-shared";
import { MoneyStrip } from "@/components/schedule/MoneyStrip";
import type { MoneyStrip as Strip } from "@/lib/scheduling/board-shared";
import { DATES, P, SUN, THU, U, WED, context, shift } from "./fixtures/schedule/rules-fixture";

const E = en as Record<string, string>;
const S = es as Record<string, string>;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(p[k]));
const FLEX = "schedule.reason.salaried_flex";

describe("H9 fix 5: the strip says what each salaried manager's flex covered", () => {
  const week = (flexSegs: Array<{ positionId: string; startQ: number; endQ: number }>, hourly: ReturnType<typeof shift>[] = []) => {
    const ctx = context();
    const base = [THU, "2026-10-23", "2026-10-24", SUN].map((d) => shift(U.alex, d, 28, 60, "mod"));
    const wed = { ...shift(U.alex, WED, 28, 60, "mod"), endQ: 60 + flexSegs.reduce((n, g) => n + g.endQ - g.startQ, 0) };
    wed.segments = [{ positionId: "mod", startQ: 28, endQ: 60 }, ...flexSegs.map((g) => ({ ...g, reasonKey: FLEX }))];
    return moneyStrip({ dates: DATES, shifts: [...base, wed, ...hourly], ctx, wageCentsByUser: {}, forecastWeekCents: null, salariedWeeklyCents: null }, { canSeeMoney: false });
  };

  it("the strip splits the flex: station hours (with the hourly time they saved) vs manager-on-duty hours", () => {
    const mod = week([{ positionId: "mod", startQ: 60, endQ: 68 }]).hours.salariedWeeks[0]!;
    expect(mod).toMatchObject({ baseHours: 40, flexHours: 2, flexStationHours: 0, flexModHours: 2, flexSavedHours: 0 });
    const station = week([{ positionId: P.REG, startQ: 60, endQ: 68 }]).hours.salariedWeeks[0]!;
    expect(station).toMatchObject({ flexHours: 2, flexStationHours: 2, flexModHours: 0, flexSavedHours: 2 });
    // Beside an hourly person already on the Register then, the flex saved no hourly time.
    const beside = week([{ positionId: P.REG, startQ: 60, endQ: 68 }], [shift(U.maya, WED, 56, 72, P.REG)]).hours.salariedWeeks[0]!;
    expect(beside).toMatchObject({ flexStationHours: 2, flexSavedHours: 0 });
  });

  const render = (w: Partial<Strip["hours"]["salariedWeeks"][number]>, lang: "en" | "es") => {
    const strip: Strip = {
      hours: {
        hourlyHours: 0, hourlyHoursOnBudgetedDates: 0, budgetHours: null, unbudgetedDates: [], remainingHours: null, otRiskCount: 0, flexUsed: 0, flexAvailable: false,
        managerFloorHours: 0, hourlySavedBySalaried: 0, managerModHours: 0, essentialHoursOnBudgetedDates: 0, essentialPastBudgetHours: null,
        salariedWeeks: [{ userId: U.alex, baseHours: 40, flexHours: 0, flexStationHours: 0, flexModHours: 0, flexSavedHours: 0, targetHours: 40, flexLimitHours: 10, ...w }],
      },
      notes: [],
    };
    const html = renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: lang, children: createElement(MoneyStrip, { strip, budgetLines: [], names: { [U.alex]: "Alex" }, positions: {}, canSetEstimates: false, locationId: "L" }) }));
    // The salaried-week line only (the strip also has a "Flex days used" metric).
    return text(html.match(/<ul[^>]*data-section="salaried-weeks"[\s\S]*?<\/ul>/)![0]);
  };

  it("en + es: MoD flex never claims savings; station flex names what it saved; no flex is just the base", () => {
    for (const [lang, L] of [["en", E], ["es", S]] as const) {
      const mod = render({ flexHours: 10, flexModHours: 10 }, lang);
      expect(mod).toContain(fill(L["schedule.board.money.salaried_week_base"]!, { name: "Alex", base: 40 }));
      expect(mod).toContain(fill(L["schedule.board.money.salaried_flex_mod"]!, { hours: 10 }));
      expect(mod).not.toContain(fill(L["schedule.board.money.salaried_flex_station"]!, { hours: 10, saved: 0 }));
      const st = render({ flexHours: 4, flexStationHours: 4, flexSavedHours: 3 }, lang);
      expect(st).toContain(fill(L["schedule.board.money.salaried_flex_station"]!, { hours: 4, saved: 3 }));
      const beside = render({ flexHours: 2, flexStationHours: 2, flexSavedHours: 0 }, lang);
      expect(beside).toContain(fill(L["schedule.board.money.salaried_flex_station_beside"]!, { hours: 2 }));
      const both = render({ flexHours: 6, flexStationHours: 4, flexSavedHours: 4, flexModHours: 2 }, lang);
      expect(both).toContain(fill(L["schedule.board.money.salaried_flex_station"]!, { hours: 4, saved: 4 }));
      expect(both).toContain(fill(L["schedule.board.money.salaried_flex_mod"]!, { hours: 2 }));
      expect(render({}, lang)).not.toMatch(/flex/i);
    }
    // The old line, which claimed "keeps hourly labor down" whatever the flex covered, is gone.
    expect(E["schedule.board.money.salaried_week"]).toBeUndefined();
    expect(S["schedule.board.money.salaried_flex_mod"]).not.toMatch(/\busted\b/i);
  });
});
