/**
 * CC chunk H9 fix 6 (2026-10-17, P3) — P Street Monday: the key holder's block read "Manager on duty 5:00 PM–9:00 PM" while
 * `keyHolderModAfterQ` is 7 PM. The COUNTING was already right (5–7 PM is not manager-on-duty time: the MoD lane and the validator
 * use `modCountsOn`); the LABEL was not. A MoD-lane segment the person only partly counts on now reads "On the clock · manager on
 * duty from 7:00 PM". en + es.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { modLane } from "@/lib/scheduling/board-shared";
import { modFromQOf } from "@/lib/scheduling/board-view-shared";
import { segmentLabel } from "@/lib/scheduling/board-format-shared";
import { PersonRow } from "@/components/schedule/PersonRow";
import { formatQ } from "@/lib/scheduling/time-shared";
import { P, THU, U, context, shift, structure } from "./fixtures/schedule/rules-fixture";

const E = en as Record<string, string>;
const S = es as Record<string, string>;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(p[k]));

describe("H9 fix 6: a key holder's MoD-lane block before keyHolderModAfterQ is not manager-on-duty time, and says so", () => {
  const ctx = context({ s: structure((x) => { x.leadership.modRequired = true; x.leadership.keyHolderModAfterQ = 76; }) });
  const kh = shift(U.iris, THU, 68, 84, "mod"); // 5:00 PM – 9:00 PM on the MoD lane

  it("COUNTING: 5–7 PM does not count as manager on duty (the lane shows the gap); 7–9 PM does", () => {
    const lane = modLane({ date: THU, day: ctx.days[THU]!, shifts: [kh], people: ctx.people, skills: { byUser: {}, closeScoreByUser: {}, bands: { building: 0.5, strong: 0.8 } }, wageCentsByUser: {} });
    expect(lane.find((h) => h.hour === 17)).toMatchObject({ userIds: [], tone: "gap" });
    expect(lane.find((h) => h.hour === 18)).toMatchObject({ userIds: [], tone: "gap" });
    expect(lane.find((h) => h.hour === 19)).toMatchObject({ userIds: [U.iris], tone: "good" });
    expect(lane.find((h) => h.hour === 20)).toMatchObject({ userIds: [U.iris], tone: "good" });
  });

  it("LABEL: the segment carries the first quarter it counts from; a shift lead's whole block does not", () => {
    expect(modFromQOf(ctx.people[U.iris], ctx.days[THU]!, kh.segments[0]!)).toBe(76);
    expect(modFromQOf(ctx.people[U.dani], ctx.days[THU]!, { positionId: "mod", startQ: 68, endQ: 84 })).toBeUndefined();
    expect(modFromQOf(ctx.people[U.iris], ctx.days[THU]!, { positionId: "mod", startQ: 60, endQ: 70 })).toBeNull();
    expect(modFromQOf(ctx.people[U.iris], ctx.days[THU]!, { positionId: P.REG, startQ: 68, endQ: 84 })).toBeUndefined();
  });

  it("en + es: the bar reads 'On the clock · manager on duty from 7:00 PM', never 'Manager on duty 5:00 PM–9:00 PM'", () => {
    const tEn = (k: string, p?: Record<string, string | number>) => fill(E[k]!, p ?? {});
    expect(segmentLabel({ t: tEn as never, language: "en", positions: {} }, { positionId: "mod", startQ: 68, endQ: 84, modFromQ: 76 })).toBe(fill(E["schedule.board.mod_from"]!, { time: "7:00 PM" }));
    expect(segmentLabel({ t: tEn as never, language: "en", positions: {} }, { positionId: "mod", startQ: 60, endQ: 70, modFromQ: null })).toBe(E["schedule.board.mod_not_counted"]);
    expect(segmentLabel({ t: tEn as never, language: "en", positions: {} }, { positionId: "mod", startQ: 68, endQ: 84 })).toBe(E["schedule.board.mod_short"]);
    for (const [lang, L] of [["en", E], ["es", S]] as const) {
      const row = {
        userId: U.iris, name: "Bea", role: "key_holder" as const, salaried: false, presenceOnly: false, weekHours: 4, otRisk: false, assumedAvailability: false, startingPoint: false, profile: [],
        shifts: [{ ref: { date: THU, userId: U.iris, startQ: 68 }, startQ: 68, endQ: 84, closingManager: false, flex: false, pinned: false, locked: false, reasons: [], alternates: [],
          segments: [{ positionId: "mod", startQ: 68, endQ: 84, mod: true, lastResort: false, reasons: [], modFromQ: 76 }] }],
      };
      const h = text(renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: lang, children: createElement(PersonRow, {
        row, axis: { fromQ: 24, toQ: 88 }, editable: false, positions: {}, names: { [U.iris]: "Bea" }, roleOf: () => "mod" as const, selectedKey: null, onSelect: () => {}, onEdit: () => {},
      }) })));
      expect(h).toContain(fill(L["schedule.board.mod_from"]!, { time: formatQ(76, lang) }));
      expect(h).not.toContain(`${L["schedule.board.mod_short"]} ${formatQ(68, lang)}`);
    }
  });
});
