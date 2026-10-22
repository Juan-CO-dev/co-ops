import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { boardView, type BoardSource } from "@/lib/scheduling/board-view-shared";
import { boardSource, DATES, I } from "./fixtures/schedule/board-source";
import { TranslationProvider } from "@/lib/i18n/provider";
import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { ScheduleBoard } from "@/components/schedule/ScheduleBoard";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { AGM_BOARD_PATHS } from "./fixtures/schedule/agm-board-paths";
import { REPAIR_LIMITS } from "@/lib/scheduling/rules-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const MON = DATES[0]!;
function crewSource(): BoardSource {
  const src = structuredClone(boardSource({ perms: { canSeeMoney: false, canBudget: false } }));
  const week = src.week!;
  const day = week.dayContexts[MON]!;
  day.structure.engine = "crew";
  day.structure.shiftTypes = [{ id: "mid", name: "Mid", fromQ: 40, toQ: 82, minLengthQ: 16, startFlexQ: 4,
    headcount: { slow: 2, normal: 2, busy: 2, weekend: 2 }, stations: [I.$REG], countsTowardMod: false }];
  day.crew = { version: 1, shifts: week.shifts.filter((s) => s.date === MON).map((s) => ({ userId: s.userId, startQ: s.startQ, typeId: "mid", source: "usual" })), manualOverrides: [],
    notes: [{ code: "usual_type_deleted", date: MON, userId: null, positionId: null, params: { typeId: "removed", count: 1, userIds: ["absent"] } }] };
  for (const kind of ["slow", "normal", "busy", "weekend"] as const) day.structure.shiftTypes[0]!.headcount[kind] = day.crew.shifts.length + 1;
  src.names.absent = "Absent Person";
  week.gaps = [
    { date: MON, code: "open_shift", positionId: null, fromQ: 40, toQ: 82, cause: "crew_shortfall", certificate: { kind: "open_shifts", items: [{ typeId: "mid", fromQ: 40, toQ: 82, required: 2, placed: 1, missing: 1, rejected: [{ userId: "absent", codes: ["off"] }] }] } },
    ...[44, 52].map((fromQ) => ({ date: MON, code: "coverage_gap" as const, positionId: I.$REG, fromQ, toQ: fromQ + 2, cause: "crew_shortfall" as const, certificate: { kind: "station_short" as const, required: 2, assigned: 1, onShiftUserIds: [] } })),
  ];
  return src;
}
function render(src: BoardSource, language: "en" | "es" = "en", selected = false) {
  const view = boardView(src);
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children:
    createElement(StepUpProvider, { unlocked: false, unlockedAt: null, children:
      createElement(ScheduleBoard, { view: { state: "ready", ...view }, initialDate: MON,
        ...(selected ? { initialSelected: view.days[0]!.rows[0]!.shifts[0]!.ref } : {}) }) }) }));
}
describe("crew board outcomes", () => {
  it.each(["pin_blocked_by_manual", "manual_person_unavailable", "budget_displaced_essential", "mod_reserved", "no_fit", "manager_limit"])("renders a translated explanation for %s", (reason) => {
    const src = crewSource();
    src.week!.dayContexts[MON]!.crew!.notes = [{ code: "crew_block_skipped", date: MON, userId: null, positionId: null, params: { reason, count: 1, userIds: ["absent"] } }];
    for (const language of ["en", "es"] as const) {
      const key = `schedule.crew.rejection.${reason}` as keyof typeof en;
      expect(render(src, language)).toContain(language === "en" ? en[key]!.replaceAll("'", "&#x27;") : es[key]);
    }
  });
  it("shows unresolved openings first too, without treating them as proven exclusions", () => {
    const src = crewSource();
    src.week!.gaps = src.week!.gaps.filter((g) => g.code !== "open_shift");
    src.week!.gaps.push({ date: MON, code: "open_shift", positionId: null, fromQ: 40, toQ: 82, cause: "unresolved_search",
      certificate: { searched: { steps: 0, donorsTried: 0, chainDepth: 0 }, limits: { ...REPAIR_LIMITS }, candidateIds: ["absent"] } });
    // An unproven certificate cannot erase the opening (the persisted type count is authoritative).
    const day = boardView(src).days[0]!;
    expect(day.crew!.openShifts).toHaveLength(1);
    expect(day.crew!.openShifts[0]).toMatchObject({ typeId: "mid", missing: 1, reasons: [{ key: "schedule.gap.certificate.unresolved_search" }] });
    const html = render(src);
    expect(html.indexOf('data-section="crew-open-shifts"')).toBeLessThan(html.indexOf('data-section="crew-day-cards"'));
    expect(html).toContain(en["schedule.gap.certificate.unresolved_search"]);
  });
  it("crew payload stays inside the reviewed AGM allowlist", () => {
    const allowed = new Set(AGM_BOARD_PATHS);
    function check(value: unknown, path = "") {
      if (Array.isArray(value)) { for (const item of value) check(item, path + "[]"); }
      else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) check(item, path + "." + ([".names", ".positions"].includes(path) || path.endsWith(".byDate") ? "*" : key));
      else expect(allowed.has(path), path).toBe(true);
    }
    check(JSON.parse(JSON.stringify(boardView(crewSource()))));
  });
  it("explains preserved historical station days without changing their context", () => {
    const src = boardSource();
    src.week = { ...src.week!, historicalCrewDates: [MON] };
    const before = JSON.stringify(src.week.dayContexts);
    expect(boardView(src).days[0]!.notes).toContainEqual({ key: "schedule.note.crew_history_preserved" });
    expect(JSON.stringify(src.week.dayContexts)).toBe(before);
  });
  it("unknown note people render the translated fallback without ids", () => {
    const src = crewSource(); delete src.names.absent;
    for (const language of ["en", "es"] as const) {
      const html = render(src, language);
      expect(html).toContain((language === "en" ? en : es)["schedule.board.person_unknown"]);
      expect(html).not.toContain("(absent)");
    }
  });
  it("historical dates still request confirmation after an intervening generated revision", () => {
    const src = crewSource(); src.liveEngine = "crew"; src.week!.edited = false; src.week!.historicalCrewDates = [MON];
    expect(boardView(src).generate).toMatchObject({ edited: true, engine: "crew", historicalEditedDates: [MON] });
    src.liveEngine = "stations"; expect(boardView(src).generate.edited).toBe(false);
    src.liveEngine = "crew"; src.today = DATES[1]!; expect(boardView(src).generate.edited).toBe(false);
  });
  it("reload preserves outcomes and deleted-type notes for people with no shift", () => {
    const src = crewSource();
    expect(boardView(JSON.parse(JSON.stringify(src)))).toEqual(boardView(src));
    const day = boardView(src).days[0]!;
    expect(day.crew?.openShifts[0]).toMatchObject({ name: "Mid", missing: 1, reasons: [{ key: "schedule.crew.rejection.off" }] });
    expect(day.notes.find((n) => n.key === "schedule.note.usual_type_deleted")?.params).toMatchObject({ peopleIds: JSON.stringify(["absent"]), count: 1 });
    expect(day.rows.flatMap((r) => r.shifts).every((s) => s.crewType?.name === "Mid")).toBe(true);
    expect(day.mod.every((m) => m.userIds.length === 0)).toBe(true);
  });
  it.each(["en", "es"] as const)("renders open shifts first, station groups, stacked cards, 44px controls and reasons (%s)", (language) => {
    const html = render(crewSource(), language, true);
    const dict = language === "en" ? en : es;
    expect(html.indexOf('data-section="crew-open-shifts"')).toBeLessThan(html.indexOf('data-section="crew-day-cards"'));
    expect(html).toContain(dict["schedule.crew.short_stretches"]);
    expect(html.match(new RegExp(`data-station="${I.$REG}"`, "g"))).toHaveLength(1);
    const cards = html.slice(html.indexOf('data-section="crew-day-cards"'), html.indexOf('data-section="crew-short-stretches"'));
    expect(cards).not.toContain("overflow-x-auto");
    const controls = cards.match(/<button[^>]*>/g)!;
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((b) => b.includes("min-h-[44px]") && b.includes("min-w-[44px]"))).toBe(true);
    expect(html).toContain('data-section="reason"');
    expect(html).not.toContain("$");
    expect(html).not.toMatch(/schedule\.crew\./);
  });
  it("station views omit all crew-only fields", () => {
    const view = boardView(boardSource());
    expect(view.days.every((d) => !("crew" in d) && d.rows.every((r) => r.shifts.every((s) => !("crewType" in s))))).toBe(true);
  });
});
