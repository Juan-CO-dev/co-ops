/**
 * PR SCH-2 (plan r5 4.5, 12.2, 22.1; rulings A2, C6, C7): the modes through the real lib flow (generate, edit another date,
 * reload, accept / decline, regenerate) over the in-memory shop, on both engines. The shop's stored mode and a 120-guest
 * order at 9:00 on Monday (heavy; T1 and T2 fire; candidate 5:30) are set on the loaded inputs.
 *  - SEMI: the draft carries a PROPOSAL and nothing is applied — not by the generator, not by a regenerate, not by an edit
 *    of another date; Accept applies the proposal's start and survives the next regenerate.
 *  - AUTO: the draft opens Monday at 5:30 by itself; Decline silences it, and the next regenerate keeps the usual start.
 *  - MANUAL (and absent): nothing is proposed or applied.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const lib = await import("@/lib/scheduling/schedules");
const { loadSchedulingInputs } = await import("@/lib/scheduling/inputs");
import type { PeopleActor } from "@/lib/people/access-shared";
import type { SchedulingInputs } from "@/lib/scheduling/inputs-shared";
import type { EarlyOpenMode } from "@/lib/scheduling/structure-shared";
import { A, GM, P_REG, STAFF, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

const NOW = new Date("2026-10-21T16:00:00Z");
const WEEK = "2026-10-26";
const MON = "2026-10-26", TUE = "2026-10-27";
const gm: PeopleActor = { userId: GM, role: "gm", level: 7, locations: [A] };

function shop(engine: "stations" | "crew", mode: EarlyOpenMode | undefined) {
  const s = scheduleStore(shopTables());
  const loadInputs = async (svc: Parameters<typeof loadSchedulingInputs>[0], a: Parameters<typeof loadSchedulingInputs>[1]): Promise<SchedulingInputs> => {
    const i = await loadSchedulingInputs(svc, a);
    const st = i.structure.structure;
    if (engine === "crew") {
      st.engine = "crew";
      st.shiftTypes = [{ id: "day", name: "Day", fromQ: 28, toQ: 60, minLengthQ: 16, startFlexQ: 4, headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [P_REG], countsTowardMod: true }];
    }
    if (mode) st.catering = { ...st.catering, earlyOpenMode: mode };
    i.catering = [...i.catering, { id: "big-mon", date: MON, name: "Order", headcount: 120, valueCents: null, eventQ: 36 }];
    return i;
  };
  return { ...s, deps: { service: s.client, now: NOW, newId: s.newId, loadInputs } };
}
type Shop = ReturnType<typeof shop>;
const headOf = (s: Shop) => String(s.tables.schedule_weeks!.find((w) => w.week_start === WEEK)!.head_revision_id);
const generate = (s: Shop, confirm = false) => {
  const w = s.tables.schedule_weeks?.find((x) => x.week_start === WEEK);
  return lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: (w?.head_revision_id as string | undefined) ?? null, confirmEdited: confirm });
};
const head = async (s: Shop) => (await s.deps.loadInputs(s.client, { locationId: A, weekStarts: [WEEK], now: NOW })).weeks[WEEK]!.head!;
const monday = async (s: Shop) => {
  const h = await head(s);
  return { opening: h.context.days[MON]?.opening ?? h.inheritedOpenings?.[MON], start: h.context.days[MON]?.structure.shopDay.prepStartQ };
};
const editTue = (s: Shop) => lib.saveEdit(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: headOf(s),
  op: { kind: "addShift", date: TUE, userId: STAFF[7]!, startQ: 44, endQ: 60, positionId: P_REG } });

describe("the modes through generate / edit / accept / decline / regenerate", () => {
  for (const engine of ["stations", "crew"] as const) {
    it(`${engine}, manual and absent: nothing is proposed or applied`, async () => {
      for (const mode of [undefined, "manual"] as const) {
        const s = shop(engine, mode);
        await generate(s);
        expect(await monday(s)).toEqual({ opening: undefined, start: 28 });
      }
    }, 120000);

    it(`${engine}, semi: a proposal, never applied by the generator, a regenerate or another date's edit; Accept applies it and it survives`, async () => {
      const s = shop(engine, "semi");
      await generate(s);
      expect(await monday(s)).toMatchObject({ opening: { status: "proposed", startQ: 22, triggers: ["prep_fit", "huge_day"] }, start: 28 });
      await generate(s, true);
      expect(await monday(s)).toMatchObject({ opening: { status: "proposed", startQ: 22 }, start: 28 });
      await editTue(s);
      expect((await monday(s)).opening).toMatchObject({ status: "proposed" });
      await generate(s, true);
      expect(await monday(s)).toMatchObject({ opening: { status: "proposed" }, start: 28 });
      const r = await lib.setDayOpening(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: headOf(s), date: MON, decision: { kind: "accept" } });
      expect(r.opening).toMatchObject({ status: "accepted", startQ: 22 });
      await generate(s, true);
      expect(await monday(s)).toMatchObject({ opening: { status: "accepted", startQ: 22 }, start: 22 });
    }, 180000);

    it(`${engine}, auto: the draft opens at 5:30 by itself; Decline silences it across regenerates`, async () => {
      const s = shop(engine, "auto");
      await generate(s);
      expect(await monday(s)).toMatchObject({ opening: { status: "auto", startQ: 22 }, start: 22 });
      const r = await lib.setDayOpening(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: headOf(s), date: MON, decision: { kind: "decline" } });
      expect(r.opening).toMatchObject({ status: "declined", startQ: 28 });
      await generate(s, true);
      expect(await monday(s)).toMatchObject({ opening: { status: "declined" }, start: 28 });
      // Clearing the decline hands the date back to the mode: auto again.
      await lib.setDayOpening(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: headOf(s), date: MON, decision: { kind: "clear" } });
      await generate(s, true);
      expect(await monday(s)).toMatchObject({ opening: { status: "auto", startQ: 22 }, start: 22 });
    }, 180000);
  }
});
