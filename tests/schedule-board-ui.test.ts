/**
 * Scheduling Phase 2, chunk F — THE BOARD, rendered with react-dom/server from the view-model the pure
 * `boardView` builds over a REAL generator week (the mockup v17 fixture, F1, and the constrained fixtures).
 *
 * Task 20 (this block): the page states (off / not installed), the money strip (7 metrics; money ABSENT for an
 * AGM — no "$" anywhere and no money key in the view), day tabs (past days locked, "Done"), the budget composition
 * and suggestion (Accept / Keep with its reasons), every banner (settings changed, demand unavailable with Generate
 * disabled and the draft unchanged, no history, week 2+ confidence, assumed availability, money blank + the MoO
 * errand), inherited problems labelled apart from new ones, unresolved_search gaps in AMBER with the candidates, the
 * current-inputs advisory apart from the verdict, and en + es parity of every key the board renders.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import type { NarrativeLine } from "@/lib/people-narrative";
import type { AdvisoryItem } from "@/lib/scheduling/context-shared";
import { DATES, boardSource, built } from "./fixtures/schedule/board-source";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/schedule", useSearchParams: () => new URLSearchParams() }));
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { StepUpProvider } = await import("@/components/admin/StepUpProvider");
const { ScheduleBoard } = await import("@/components/schedule/ScheduleBoard");
const { boardView } = await import("@/lib/scheduling/board-view-shared");
type PageView = Parameters<typeof ScheduleBoard>[0]["view"];

export const renderBoard = (view: PageView, language: "en" | "es" = "en", extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(StepUpProvider, { unlocked: false, unlockedAt: null, children: createElement(ScheduleBoard, { view, ...extra }) as ReactNode }) }));
const ready = (over: Parameters<typeof boardSource>[0] = {}, fixture?: string) => ({ state: "ready" as const, ...boardView(boardSource(over, fixture)) });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("Task 20 — the page states", () => {
  it("not enabled → 'Scheduling is off for this shop' (+ the MoO line only for MoO+); not installed → the 503 line", () => {
    const gm = text(renderBoard({ state: "off", canTurnOn: false }));
    expect(gm).toContain(en["schedule.page.off"]);
    expect(gm).not.toContain(en["schedule.page.off_moo"]);
    const moo = renderBoard({ state: "off", canTurnOn: true });
    expect(text(moo)).toContain(en["schedule.page.off_moo"]);
    expect(moo).toContain('href="/schedule/settings"');
    expect(text(renderBoard({ state: "not_installed" }))).toContain(en["schedule.error.inputs_unavailable"]);
    expect(text(renderBoard({ state: "off", canTurnOn: true }, "es"))).toContain(es["schedule.page.off"]);
  });
});

describe("Task 20 — money (J1): an AGM sees hours, never dollars", () => {
  it("the view carries NO money key and the HTML has no '$' anywhere", () => {
    const view = boardView(boardSource({ perms: { canSeeMoney: false, canApprove: false, canEditStructure: false } }));
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/"(money|hourlyCostCents|hourlyPct|salariedFixedCents|totalPct|maxLaborCents|blendedWageCents|salariedDayCents|wageCentsByUser|cents)"/);
    expect(view.strip!.money).toBeUndefined();
    expect(view.days.every((d) => d.laborByHour === null)).toBe(true);
    const html = renderBoard({ state: "ready", ...view });
    expect(html).not.toContain("$");
    expect(text(html)).toContain(en["schedule.board.money.hidden"]);
    // The GM sees dollars.
    expect(renderBoard(ready())).toContain("$");
  });
});

describe("Task 20 — the strip, the tabs, the suggestion", () => {
  it("the strip's 7 metrics carry their labels (hours vs budget, hourly $ / %, salaried, TOTAL %, OT risk, flex used, manager floor h + hourly h saved)", () => {
    const t = text(renderBoard(ready()));
    for (const k of ["hours_vs_budget", "hourly_cost", "salaried", "total_pct", "ot_risk", "flex_used", "manager_floor"] as const) expect(t).toContain(en[`schedule.board.money.${k}`]);
    expect(t).toContain(en["schedule.board.flag.flex_later"]);
  });

  it("past day tabs are aria-disabled with 'Done'; today and later are live; the selected tab is aria-selected", () => {
    const html = renderBoard(ready({ today: DATES[2]! }));
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(tabs).toHaveLength(7);
    expect(tabs.slice(0, 2).every((b) => b.includes('aria-disabled="true"') && b.includes(en["schedule.board.day_tab.done"]))).toBe(true);
    expect(tabs.slice(2).every((b) => !b.includes('aria-disabled="true"'))).toBe(true);
    expect(tabs[2]).toContain('aria-selected="true"');
  });

  it("the suggestion shows its reasons and Accept / Keep (44 px); a quiet or hidden one shows nothing; an unavailable one names its errand", () => {
    const suggestion = { kind: "suggestion" as const, weekStart: DATES[0]!, referenceWeek: "2026-10-12", byDate: Object.fromEntries(DATES.map((d) => [d, 60])), total: 420, ratio: 1.12,
      matchedDows: [1, 2, 3, 4, 5, 6, 7], clamped: [], digest: "dg1",
      lines: [{ key: "schedule.budget.ratio", params: { pct: 12, referenceWeek: "2026-10-12", matched: "1,2,3,4,5,6,7", matchedDays: 7 } }, { key: "schedule.budget.catering_delta", params: { date: DATES[3]!, hours: 4 } }] as NarrativeLine[] };
    const html = renderBoard(ready({ suggestion }));
    const t = text(html);
    expect(t).toContain(en["schedule.board.suggest.title"].replace("{hours}", "420"));
    expect(t).toContain("12%");
    expect(t).toContain(en["schedule.board.suggest.accept"].replace("{hours}", "420"));
    expect(t).toContain(en["schedule.board.suggest.keep"]);
    const buttons = html.match(/<button[^>]*data-suggest="(accept|keep)"[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => b.includes("min-h-[44px]") && b.includes("items-center"))).toBe(true);
    expect(text(renderBoard(ready({ suggestion: { kind: "quiet", reason: "deadband", total: 420, digest: "q" } })))).not.toContain(en["schedule.board.suggest.keep"]);
    const unavailable = { kind: "unavailable" as const, code: "suggestion_unavailable" as const, cause: "no_reference" as const, errand: { key: "schedule.budget.errand.no_reference" } };
    expect(text(renderBoard(ready({ suggestion: unavailable })))).toContain(en["schedule.budget.errand.no_reference"]);
    // An AGM (no budget act) never sees Accept / Keep.
    expect(text(renderBoard(ready({ suggestion, perms: { canBudget: false, canSeeMoney: false } })))).not.toContain(en["schedule.board.suggest.keep"]);
  });

  it("the budget composition line ('Week budget: 52 h over …') and unbudgeted days", () => {
    const budget = {
      byDate: Object.fromEntries(DATES.map((d, i) => [d, i < 5 ? 10 : null])), total: 50, unbudgetedDates: DATES.slice(5),
      composition: DATES.slice(0, 5).map((d) => ({ date: d, entryId: "e1", scope: "month" as const, hours: 10 })),
      lines: [{ key: "schedule.budget.composition", params: { scope: "month", from: DATES[0]!, to: DATES[4]!, days: 5, hours: 50 } }, { key: "schedule.budget.unbudgeted", params: { date: DATES[5]! } }] as NarrativeLine[],
    };
    const t = text(renderBoard(ready({ budget })));
    expect(t).toContain(`${en["schedule.board.scope.month"]} budget: 50 h over 5 days`);
    expect(t).toMatch(/Sat, Oct 31 has no budget\./);
  });

  it("chunk G (CC): no budget on any day → ONE line 'No budget set for this week. Set one', linking the budget control (en + es)", () => {
    const html = renderBoard(ready());
    const t = text(html);
    expect(t.split(en["schedule.budget.none_set"]).length - 1).toBe(1);
    expect(t).not.toMatch(/has no budget/);
    expect(html).toMatch(new RegExp(`<a[^>]*href="#schedule-budget-set"[^>]*>${en["schedule.board.budget.set_link"]}</a>`));
    const setter = html.match(/<section[^>]*id="schedule-budget-set"[\s\S]*?<\/section>/)![0];
    expect(text(setter)).toContain(en["schedule.board.budget.title"]);
    expect(text(setter)).toContain(en["schedule.board.budget.scope_week"]);
    expect(text(setter)).toContain(en["schedule.board.budget.scope_month"]);
    const save = setter.match(/<button[^>]*data-act="budget-save"[^>]*>/)![0];
    expect(save).toContain("min-h-[44px]");
    expect(save).toContain("items-center");
    const es1 = renderBoard(ready(), "es");
    expect(text(es1)).toContain(es["schedule.budget.none_set"]);
    expect(es1).toContain(`>${es["schedule.board.budget.set_link"]}</a>`);
    // A viewer without the budget act (an AGM reading) sees the line, no link and no control.
    const agm = renderBoard(ready({ perms: { canBudget: false, canSeeMoney: false, canEdit: false, canApprove: false } }));
    expect(text(agm)).toContain(en["schedule.budget.none_set"]);
    expect(agm).not.toContain('href="#schedule-budget-set"');
    expect(agm).not.toContain('id="schedule-budget-set"');
  });

  it("chunk G: the budget control posts the route's EXACT body (week or month, the hours)", async () => {
    const { budgetBody } = await import("@/components/schedule/BudgetSetter");
    const { SCHEDULE_ACTIONS } = await import("@/lib/scheduling/route-shapes-shared");
    const week = budgetBody("loc-1", "week", DATES[0]!, 312.5);
    expect(week).toEqual({ action: "budget", locationId: "loc-1", scope: "week", weekStart: DATES[0]!, month: null, hours: 312.5 });
    expect(Object.keys(week).sort()).toEqual([...SCHEDULE_ACTIONS.budget!].sort());
    expect(budgetBody("loc-1", "month", DATES[0]!, 1200)).toEqual({ action: "budget", locationId: "loc-1", scope: "month", weekStart: null, month: "2026-10-01", hours: 1200 });
  });
});

describe("Task 20 — banners", () => {
  it("'Settings changed — regenerate?' only when the live structure moved", () => {
    expect(text(renderBoard(ready()))).not.toContain(en["schedule.board.banner.settings_changed"]);
    expect(text(renderBoard(ready({ liveStructureId: "sv-newer" })))).toContain(en["schedule.board.banner.settings_changed"]);
  });

  it("demand unavailable → the banner; Generate/Regenerate disabled; the existing draft shown unchanged", () => {
    const view = ready({ demand: "unavailable" });
    expect(view.generate.disabled).toBe(true);
    const html = renderBoard(view);
    expect(text(html)).toContain(en["schedule.board.banner.demand_unavailable"]);
    const regen = html.match(/<button[^>]*data-act="regenerate"[^>]*>/)![0];
    expect(regen).toContain('disabled=""');
    const ok = ready();
    expect(view.days.map((d) => d.rows.length)).toEqual(ok.days.map((d) => d.rows.length));
  });

  it("no_history → the Normal-crew note; week 2+ → the confidence note; the assumed-availability line", () => {
    const out = built();
    const ctx = Object.fromEntries(DATES.map((d) => [d, { ...out.context.days[d]!, inputs: { ...out.context.days[d]!.inputs, demandKind: "no_history" as const, hourlyCents: null, dayCents: null } }]));
    const t = text(renderBoard(ready({ demand: "no_history", week: { ...boardSource().week!, dayContexts: ctx }, weeksAhead: 2 })));
    expect(t).toContain(en["schedule.note.no_history"]);
    expect(t).toContain(en["schedule.board.banner.further_out"]);
    expect(t).toContain(en["schedule.board.flag.assumed_availability"]);
    expect(text(renderBoard(ready()))).not.toContain(en["schedule.board.banner.further_out"]);
  });

  it("money blank until the MoO sets the estimates: '—' + the errand (an unknown wage is never $0)", () => {
    const src = boardSource();
    const wages = Object.fromEntries(Object.keys(src.wageCentsByUser).map((k) => [k, null]));
    const view = ready({ wageCentsByUser: wages, shopEstimateHourlyCents: null, salariedWeeklyCents: null });
    expect(view.strip!.money!.hourlyCostCents).toBeNull();
    const t = text(renderBoard(view));
    expect(t).toContain(en["schedule.board.money.errand_set_wage"]);
    expect(t).not.toContain("$0.00");
  });
});

describe("Task 20 — problems, gaps, the advisory", () => {
  it("inherited problems carry 'Earlier problem', apart from new ones", () => {
    const view = ready({}, "F0g-history");
    expect(view.rules.inherited.length).toBeGreaterThan(0);
    const t = text(renderBoard(view));
    expect(t).toContain(en["schedule.board.problem.earlier"]);
  });

  it("unresolved_search gaps are AMBER with 'No fill found within the search limit — you may find one' and the candidates", () => {
    const view = ready({}, "F17-inherited-unresolved");
    const g = view.gaps.find((x) => x.cause === "unresolved_search")!;
    expect(g).toBeDefined();
    expect(g.tone).toBe("amber");
    expect(g.blocksApprove).toBe(true);
    const html = renderBoard(view, "en", { initialDate: g.date });
    expect(html).toMatch(/data-gap-cause="unresolved_search"[^>]*data-tone="amber"/);
    expect(text(html)).toContain("No fill found within the search limit — you may find one");
  });

  it("the current-inputs advisory ('Since this was built: …') renders apart from the original verdict", () => {
    const advisory: AdvisoryItem[] = [{ code: "budget_changed", date: DATES[1]!, userId: null, params: { from: 50, to: 60 } }, { code: "member_added", date: null, userId: "u-05-dani", params: {} }];
    const html = renderBoard(ready({ advisory }));
    expect(html).toMatch(/data-section="advisory"/);
    const t = text(html);
    expect(t).toContain(en["schedule.board.advisory.title"]);
    expect(t).toContain("Dani");
  });
});

describe("Task 21 — the day timeline", () => {
  const html = (over: Parameters<typeof boardSource>[0] = {}, fixture?: string, date = DATES[3]!) => renderBoard(ready(over, fixture), "en", { initialDate: date });
  it("the demand SVG carries an aria-label naming its basis (4-week same-day average); a no-history day draws none", () => {
    const h = html();
    expect(h).toMatch(/<svg[^>]*role="img"[^>]*aria-label="[^"]*4-week same-day average[^"]*"/);
    const out = built();
    const ctx = Object.fromEntries(DATES.map((d) => [d, { ...out.context.days[d]!, inputs: { ...out.context.days[d]!.inputs, demandKind: "no_history" as const, hourlyCents: null, dayCents: null } }]));
    expect(html({ demand: "no_history", week: { ...boardSource().week!, dayContexts: ctx } })).not.toMatch(/<svg[^>]*aria-label="[^"]*4-week/);
  });
  it("the labor % row is toned from the shop target (good / watch / high / none) with a text label; an AGM gets no labor row", () => {
    const h = html();
    const cells = h.match(/data-labor-tone="(good|watch|high|none)"/g) ?? [];
    expect(cells.length).toBeGreaterThan(5);
    expect(h).toMatch(/data-labor-tone="good"[^>]*>[\s\S]*?On target/);
    expect(html({ perms: { canSeeMoney: false } })).not.toMatch(/data-labor-tone=/);
  });
  it("coverage cells: red / amber / green / grey, each with its TEXT label (colour is never the only signal)", () => {
    const view = ready({}, "F0b-tight-budget-zero");
    const day = view.days.find((d) => d.coverage.some((c) => c.tone === "gap"))!;
    const h = renderBoard(view, "en", { initialDate: day.date });
    for (const [tone, label] of [["gap", "Short"], ["good", "Covered"], ["closed", "Closed"]] as const) {
      expect(h, tone).toMatch(new RegExp(`data-coverage-tone="${tone}"[^>]*>[\\s\\S]*?${label}`));
    }
  });
  it("the MoD lane flags its gaps; the Closing Manager row names the closer or the gap", () => {
    const view = ready({}, "F0a-infeasible-structure");
    const day = view.days.find((d) => d.mod.some((m) => m.tone === "gap"))!;
    const h = renderBoard(view, "en", { initialDate: day.date });
    expect(h).toMatch(/data-mod-tone="gap"[^>]*>[\s\S]*?No manager on duty/);
    const v17 = html();
    expect(v17).toMatch(/data-closing-state="covered"[^>]*>[\s\S]*?Closing Manager/);
  });
  it("strength chips per window carry the window and the word", () => {
    const t = text(html());
    expect(t).toMatch(/Lunch rush: (Strong|Watch|Thin|Starting point|Nobody on)/);
    expect(t).toMatch(/Close: (Strong|Watch|Thin|Starting point|Nobody on)/);
  });
  it("the labor-target card shows each math line, turns amber, and an AGM sees heads without dollars", () => {
    const view = ready();
    const day = view.days.find((d) => d.labor?.state === "ok" && d.labor.windows.some((w) => w.tone === "amber")) ?? view.days[3]!;
    const h = renderBoard(view, "en", { initialDate: day.date });
    const card = h.match(/<section[^>]*data-section="labor-target"[\s\S]*?<\/section>/)![0];
    expect(text(card)).toMatch(/Max hourly labor \$ = forecast sales × target %: \$[\d,]+ × 28% = \$[\d,]+/);
    expect(text(card)).toMatch(/Max hours = max labor \$ ÷ blended average wage/);
    expect(text(card)).toMatch(/Lunch rush: \d+ on, optimal \d+(–\d+)?/);
    if (day.labor?.state === "ok" && day.labor.windows.some((w) => w.tone === "amber")) expect(card).toContain('data-tone="amber"');
    const agm = renderBoard(ready({ perms: { canSeeMoney: false } }), "en", { initialDate: day.date });
    const agmCard = agm.match(/<section[^>]*data-section="labor-target"[\s\S]*?<\/section>/)![0];
    expect(agmCard).not.toContain("$");
    expect(text(agmCard)).toMatch(/Lunch rush: \d+ on, optimal/);
  });
  it("chunk G (CC's 375 px read): the card never contradicts itself — no per-window 'already over the target', amber only on a window over its optimal", () => {
    const view = ready();
    for (const d of view.days) {
      if (d.labor?.state !== "ok") continue;
      for (const w of d.labor.windows) {
        expect(w.optimal.min).toBeGreaterThanOrEqual(w.floorHeads);
        expect(w.tone === "amber").toBe((w.overQuarters ?? 0) > 0);
      }
      for (const lang of ["en", "es"] as const) {
        const card = renderBoard(view, lang, { initialDate: d.date }).match(/<section[^>]*data-section="labor-target"[\s\S]*?<\/section>/)![0];
        expect(text(card)).not.toMatch(/already over the target|ya pasa del objetivo/);
        const notes = text(card).split(lang === "en" ? "minimum crews alone are above" : "solo los equipos mínimos ya pasan").length - 1;
        expect(notes).toBeLessThanOrEqual(1);
      }
    }
  });
  it("chunk G: the minimums-over-target note renders ONCE with its math line, in en and es", () => {
    const view = ready();
    const day = view.days.find((d) => d.labor?.state === "ok")!;
    if (day.labor?.state !== "ok") throw new Error("no labor");
    const forced = { ...view, days: view.days.map((d) => d.date !== day.date || d.labor?.state !== "ok" ? d : { ...d, labor: { ...d.labor, lines: [
      { key: "schedule.labor.minimums_over_target", params: { targetPct: 28 } },
      { key: "schedule.labor.minimums_over_target_math", params: { minHours: 60, wageCents: 2050, minCostCents: 123000, maxLaborCents: 120400 } },
      ...d.labor.lines] } }) };
    const en1 = text(renderBoard(forced, "en", { initialDate: day.date }));
    expect(en1).toContain("At this day's forecast, the minimum crews alone are above 28%. The target can't be met without more sales or smaller minimums.");
    expect(en1).toMatch(/Minimum-crew hours salaried managers don't cover: 60 h × \$[\d.,]+\/h = \$1,230, more than the \$1,204 the target allows\./);
    const es1 = text(renderBoard(forced, "es", { initialDate: day.date }));
    expect(es1).toContain(es["schedule.labor.minimums_over_target"].replace("{targetPct}", "28"));
  });
  it("the rules badge: 'all checks pass' or 'N problems', opening the named problems with day, person, position and time", () => {
    const view = ready({}, "F0g-history");
    const h = renderBoard(view);
    expect(text(h)).toContain(en["schedule.board.rules.problems"].replace("{n}", String(view.rules.fresh.length + view.rules.inherited.length)));
    expect(h).toMatch(/data-problem="shift_below_minimum"/);
    expect(text(h)).toContain("Shift is shorter than the minimum (240 min).");
    const clean = { ...ready(), rules: { fresh: [], inherited: [] } };
    expect(text(renderBoard(clean))).toContain(en["schedule.board.rules.pass"]);
    expect(text(renderBoard(ready({}, "F0g-history"), "es"))).toContain(es["schedule.board.problem.earlier"]);
  });
  it("the timeline is the ONE horizontally scrollable region (the page never is), with a sticky label column and a Fit hours toggle", () => {
    const h = html();
    expect((h.match(/overflow-x-auto/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(h).toMatch(/data-section="timeline"[^>]*class="[^"]*overflow-x-auto/);
    expect(h).toMatch(/sticky left-0/);
    expect(h).toMatch(/<button[^>]*aria-pressed="false"[^>]*data-act="fit"[^>]*>|<button[^>]*data-act="fit"[^>]*aria-pressed="false"/);
  });
});

describe("Task 22 — drag and keyboard → edit ops (pure; the real pointer walk is CC's browser sim)", () => {
  const sh = { ref: { date: DATES[2]!, userId: "u", startQ: 40 }, startQ: 40, endQ: 64, segments: [{ positionId: "p1", startQ: 40, endQ: 50 }, { positionId: "p2", startQ: 50, endQ: 64 }] };
  it("dragToOp turns pixels into 15-minute steps through the edit vocabulary; under half a step is no op", async () => {
    const { dragToOp } = await import("@/components/schedule/use-drag-snap-shared");
    const { isEditOp } = await import("@/lib/scheduling/edit-shared");
    expect(dragToOp(32, 16, { kind: "move" }, sh)).toEqual({ kind: "move", shift: sh.ref, deltaQ: 2 });
    expect(dragToOp(-16, 16, { kind: "start" }, sh)).toEqual({ kind: "start", shift: sh.ref, toQ: 39 });
    expect(dragToOp(48, 16, { kind: "end" }, sh)).toEqual({ kind: "end", shift: sh.ref, toQ: 67 });
    expect(dragToOp(-32, 16, { kind: "divider", index: 1 }, sh)).toEqual({ kind: "divider", shift: sh.ref, index: 1, toQ: 48 });
    expect(dragToOp(7, 16, { kind: "move" }, sh)).toBeNull();
    expect(dragToOp(32, 0, { kind: "move" }, sh)).toBeNull();
    for (const op of [dragToOp(32, 16, { kind: "move" }, sh), dragToOp(-32, 16, { kind: "divider", index: 1 }, sh)]) expect(isEditOp(op)).toBe(true);
  });
  it("keyToOp: ArrowLeft / ArrowRight are −15 / +15 min on the bar, an edge or a divider; any other key is nothing", async () => {
    const { keyToOp } = await import("@/components/schedule/use-drag-snap-shared");
    expect(keyToOp("ArrowLeft", { kind: "move" }, sh)).toEqual({ kind: "move", shift: sh.ref, deltaQ: -1 });
    expect(keyToOp("ArrowRight", { kind: "end" }, sh)).toEqual({ kind: "end", shift: sh.ref, toQ: 65 });
    expect(keyToOp("ArrowRight", { kind: "divider", index: 1 }, sh)).toEqual({ kind: "divider", shift: sh.ref, index: 1, toQ: 51 });
    expect(keyToOp("Enter", { kind: "move" }, sh)).toBeNull();
  });
  it("an accepted edit posts exactly {action: edit, locationId, weekStart, expectedHead, op}", async () => {
    const { editBody } = await import("@/components/schedule/use-drag-snap-shared");
    const { SCHEDULE_ACTIONS } = await import("@/lib/scheduling/route-shapes-shared");
    const op = { kind: "move" as const, shift: sh.ref, deltaQ: 1 };
    const body = editBody({ locationId: "L", weekStart: DATES[0]!, expectedHead: "h1" }, op);
    expect(body).toEqual({ action: "edit", locationId: "L", weekStart: DATES[0]!, expectedHead: "h1", op });
    expect(Object.keys(body).sort()).toEqual([...SCHEDULE_ACTIONS.edit!].sort());
  });
  it("the stale-response reducer: a response for an older head or an older request is DISCARDED; head_moved reloads with its notice; a refusal snaps back with its name", async () => {
    const { editReducer, initialEditState } = await import("@/components/schedule/use-drag-snap-shared");
    let s = initialEditState("h1");
    s = editReducer(s, { type: "submit" });
    expect(s.pending).toEqual({ expectedHead: "h1", seq: 1 });
    // A late answer to an older request: ignored.
    expect(editReducer(s, { type: "accepted", seq: 0, expectedHead: "h1", revisionId: "hX" })).toBe(s);
    // An answer computed against another head: ignored.
    expect(editReducer(s, { type: "accepted", seq: 1, expectedHead: "h0", revisionId: "hX" })).toBe(s);
    const ok = editReducer(s, { type: "accepted", seq: 1, expectedHead: "h1", revisionId: "h2" });
    expect(ok).toMatchObject({ head: "h2", pending: null, reload: true, error: null, notice: null });
    const moved = editReducer(s, { type: "refused", seq: 1, expectedHead: "h1", code: "head_moved" });
    // CC chunk H9: "loading the latest" until the reload brings a NEW head; then "your view is updated".
    expect(moved).toMatchObject({ pending: null, reload: true, notice: "head_moving" });
    const refused = editReducer(s, { type: "refused", seq: 1, expectedHead: "h1", code: "edit_overlap" });
    expect(refused).toMatchObject({ pending: null, reload: false, error: "edit_overlap", snapBack: s.snapBack + 1 });
    expect(editReducer(moved, { type: "reloaded", head: "h9" })).toMatchObject({ head: "h9", reload: false, notice: "head_moved" });
  });
  it("Astra chunk F P2-2: submit against A → reload B → A's late response: the board is NOT left disabled (pending cleared), and A's answer is discarded", async () => {
    const { editReducer, initialEditState } = await import("@/components/schedule/use-drag-snap-shared");
    let s = editReducer(initialEditState("hA"), { type: "submit" });
    expect(s.pending).not.toBeNull();
    s = editReducer(s, { type: "reloaded", head: "hB" });
    expect(s).toMatchObject({ head: "hB", pending: null });
    // A's late answers, accepted or refused, change nothing and leave the board editable.
    expect(editReducer(s, { type: "accepted", seq: 1, expectedHead: "hA", revisionId: "hA2" })).toBe(s);
    expect(editReducer(s, { type: "refused", seq: 1, expectedHead: "hA", code: "head_moved" })).toBe(s);
    // A new edit on B works normally.
    const next = editReducer(s, { type: "submit" });
    expect(next.pending).toEqual({ expectedHead: "hB", seq: 2 });
    // A reload to the SAME head while a request is in flight keeps that request (nothing replaced it).
    const same = editReducer(editReducer(initialEditState("hA"), { type: "submit" }), { type: "reloaded", head: "hA" });
    expect(same.pending).toEqual({ expectedHead: "hA", seq: 1 });
  });
});

describe("Task 22 — person rows, handles and the reason panel", () => {
  const MULTI = { date: "2026-10-30", userId: "u-15-alex", startQ: 28 };
  it("multi-segment bars: one segment button per segment, a divider between each pair, two edges; every handle is named", () => {
    const h = renderBoard(ready(), "en", { initialDate: MULTI.date });
    const bar = h.match(/<div[^>]*data-shift="2026-10-30\|u-15-alex\|28"[\s\S]*?data-shift-end="2026-10-30\|u-15-alex\|28"/)![0];
    expect((bar.match(/data-segment="/g) ?? []).length).toBe(3);
    expect((bar.match(/data-handle="divider"/g) ?? []).length).toBe(2);
    expect((bar.match(/data-handle="(start|end)"/g) ?? []).length).toBe(2);
    for (const b of h.match(/<button[^>]*data-handle="[^"]*"[^>]*>/g) ?? []) expect(b).toMatch(/aria-label="[^"]+"/);
  });
  it("a locked (past) day renders no handles at all", () => {
    const h = renderBoard(ready({ today: DATES[6]! }), "en", { initialDate: MULTI.date });
    expect(h).toMatch(/data-shift="2026-10-30\|u-15-alex\|28"/);
    expect(h).not.toMatch(/data-handle=/);
  });
  it("the keyboard twin: the selected shift has −15 / +15 min buttons (44 px) for the bar, each edge and each divider", () => {
    const h = renderBoard(ready(), "en", { initialDate: MULTI.date, initialSelected: MULTI });
    const panel = h.match(/<section[^>]*data-section="reason"[\s\S]*?<\/section>/)![0];
    const nudges = panel.match(/<button[^>]*data-nudge="[^"]+"[^>]*>/g) ?? [];
    expect(nudges.length).toBe(2 * (1 + 2 + 2)); // move, start, end, two dividers × (−15, +15)
    for (const b of nudges) { expect(b).toContain("min-h-[44px]"); expect(b).toContain("items-center"); }
    expect(text(panel)).toContain("−15 min");
    expect(text(panel)).toContain("+15 min");
  });
  it("the reason panel: why this person / shape / segment, the skill profile as bands, who else could cover, the flags — never a wage or a $", () => {
    const h = renderBoard(ready(), "en", { initialDate: MULTI.date, initialSelected: MULTI });
    const panel = h.match(/<section[^>]*data-section="reason"[\s\S]*?<\/section>/)![0];
    const t = text(panel);
    expect(t).toContain("Alex");
    expect(t).toMatch(/Why this shift/);
    expect(panel).toMatch(/data-reason="[a-z_]+"/);
    expect(t).toMatch(/(Strong|Solid|Building|Starting point)/);
    expect(t).toContain(en["schedule.board.flag.assumed_availability"]);
    expect(panel).not.toContain("$");
    expect(panel).not.toMatch(/wage|1900|19\.00/i);
  });
  it("CC chunk F GO: a fill found inside the budget shows its reason budget_fill on the board", () => {
    // CC chunk H9 (p2.13): two days off and the soft-range tiers moved the fills — the found-in-budget fill is now Ivy on Thursday.
    const sel = { date: "2026-10-29", userId: "u-i-ivy", startQ: 38 };
    const view = ready({ today: "2026-10-26" }, "F11-budget-week-then-month");
    const h = renderBoard(view, "en", { initialDate: sel.date, initialSelected: sel });
    const panel = h.match(/<section[^>]*data-section="reason"[\s\S]*?<\/section>/)![0];
    expect(panel).toContain('data-reason="budget_fill"');
    expect(text(panel)).toContain(en["schedule.reason.budget_fill"]);
    expect(text(renderBoard(view, "es", { initialDate: sel.date, initialSelected: sel }))).toContain(es["schedule.reason.budget_fill"]);
  });
  it("a refused edit names its refusal; head_moved says the view was updated", async () => {
    const { EditNotice } = await import("@/components/schedule/PersonRow");
    const { initialEditState } = await import("@/components/schedule/use-drag-snap-shared");
    const r = (state: ReturnType<typeof initialEditState>, lang: "en" | "es" = "en") =>
      renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: lang, children: createElement(EditNotice, { state }) }));
    expect(text(r({ ...initialEditState("h"), error: "edit_overlap" }))).toContain(en["schedule.error.edit_overlap"]);
    expect(text(r({ ...initialEditState("h"), notice: "head_moved" }))).toContain((en as Record<string, string>)["schedule.board.edit.head_moved"]!);
    expect((en as Record<string, string>)["schedule.board.edit.head_moved"]).toBe("Someone else changed this week — your view is updated");
    expect(text(r({ ...initialEditState("h"), notice: "head_moved" }, "es"))).toContain((es as Record<string, string>)["schedule.board.edit.head_moved"]!);
  });
});

describe("Task 23 — the horizon builder, What changed, Approve", () => {
  const diff = (days: Array<{ date: string; changes: Array<Record<string, unknown>> }>, added = 1) => ({
    summary: { added, removed: 0, moved: 1, relabelled: 0, closingManagerChanged: 0, gapHoursDelta: -1, hourlyHoursDelta: 2, newProblemsDelta: 0, inheritedProblemsDelta: 0 },
    summaryLine: { key: "schedule.diff.summary", params: { days: days.length, added, removed: 0, moved: 1, relabelled: 0, gapHoursDelta: -1, hourlyHoursDelta: 2 } },
    days,
  });
  const W1 = "2026-10-26", W2 = "2026-11-02";
  const preview = {
    token: "tok-1",
    request: { mode: "next_weeks" as const, n: 2 },
    weeks: [
      { weekStart: W1, buildDays: [W1], keptDays: [], confidence: "normal" as const, edited: false, headRevisionId: "h1",
        whatChanged: diff([{ date: W1, changes: [{ kind: "person_added", userId: "u-05-dani", startQ: 44, endQ: 60 }] }]),
        problems: { newErrors: 0, newGaps: 2, newWarnings: 0, inherited: 3, unresolved: 1, budgetLimited: 1 },
        gaps: [
          { date: W1, code: "coverage_gap" as const, positionId: null, fromQ: 44, toQ: 52, cause: "budget_limited" as const, line: { key: "schedule.gap.certificate.budget_limited", params: { fillHours: 3.5, remainingHours: 1 } } },
          { date: W1, code: "coverage_gap" as const, positionId: null, fromQ: 60, toQ: 64, cause: "unresolved_search" as const, line: { key: "schedule.gap.certificate.unresolved_search" } },
        ], hourlyHoursOnBudgetedDates: 40 },
      { weekStart: W2, buildDays: [W2], keptDays: [], confidence: "further_out" as const, edited: true, headRevisionId: "h2",
        whatChanged: diff([], 0), problems: { newErrors: 0, newGaps: 0, newWarnings: 0, inherited: 0, unresolved: 0, budgetLimited: 0 }, gaps: [], hourlyHoursOnBudgetedDates: 0 },
    ],
  };
  const H = async (props: Record<string, unknown>, lang: "en" | "es" = "en") => {
    const { HorizonBuilder } = await import("@/components/schedule/HorizonBuilder");
    return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: lang, children: createElement(StepUpProvider, { unlocked: false, unlockedAt: null,
      children: createElement(HorizonBuilder, { locationId: "L", names: { "u-05-dani": "Dani" }, positions: {}, ...props }) as ReactNode }) }));
  };

  it("the board hosts the horizon builder for an editor and Approve for an approver; an AGM (read only) sees neither", () => {
    const gm = renderBoard(ready());
    expect(gm).toContain('data-section="horizon"');
    expect(gm).toMatch(/<button[^>]*data-act="approve"/);
    const agm = renderBoard(ready({ perms: { canSeeMoney: false, canEdit: false, canApprove: false, canBudget: false, canEditStructure: false } }));
    expect(agm).not.toContain('data-section="horizon"');
    expect(agm).not.toMatch(/data-act="approve"/);
    // Task 24: the way to the settings (the editor's), never a dead end.
    expect(gm).toMatch(/href="\/schedule\/settings\?loc=[^"]+"/);
    expect(agm).not.toMatch(/href="\/schedule\/settings/);
  });

  it("the horizon choices: next week · next N weeks · rest of the month · a month (44 px)", async () => {
    const h = await H({});
    const t = text(h);
    for (const k of ["next_week", "next_weeks", "rest_of_month", "month"]) expect(t).toContain(en[`schedule.board.horizon.mode.${k}` as keyof typeof en]);
    for (const l of h.match(/<label[^>]*data-mode=[^>]*>/g) ?? []) { expect(l).toContain("min-h-[44px]"); expect(l).toContain("items-center"); }
    const { requestFor } = await import("@/components/schedule/horizon-flow-shared");
    expect(requestFor({ mode: "next_weeks", n: 3, month: "2026-11" })).toEqual({ mode: "next_weeks", n: 3 });
    expect(requestFor({ mode: "month", n: 2, month: "2026-11" })).toEqual({ mode: "month", month: "2026-11" });
    expect(requestFor({ mode: "next_week", n: 2, month: "2026-11" })).toEqual({ mode: "next_week" });
  });

  it("the preview: per-week What changed (summary + a COLLAPSED per-day list), gaps by cause with the certificate line, earlier problems labelled", async () => {
    const h = await H({ initialPreview: preview });
    const t = text(h);
    expect(t).toContain("1 days changed: 1 added");
    expect(h).toMatch(/<button[^>]*aria-expanded="false"[^>]*data-days=/);
    expect(t).toContain("Over budget: needs at least ~3.5 h (best fill found); 1 h of budget left.");
    expect(t).toContain("No fill found within the search limit — you may find one.");
    expect(t).toContain(en["schedule.board.horizon.earlier_problems"].replace("{n}", "3"));
    expect(t).toContain(en["schedule.board.banner.further_out"]);
  });

  it("an edited week warns and asks per week (a 44 px label); Apply needs Tier B ONLY when an edited week is checked; unchecked edited weeks are skipped and say so", async () => {
    const h = await H({ initialPreview: preview });
    expect(text(h)).toContain(en["schedule.board.horizon.edited_warning"]);
    const label = h.match(/<label[^>]*data-confirm-week="2026-11-02"[^>]*>/)![0];
    expect(label).toContain("min-h-[44px]");
    const { applyNeedsStepUp, skippedWeeks } = await import("@/components/schedule/horizon-flow-shared");
    expect(applyNeedsStepUp(preview, [])).toBe(false);
    expect(applyNeedsStepUp(preview, [W1])).toBe(false);
    expect(applyNeedsStepUp(preview, [W2])).toBe(true);
    expect(skippedWeeks(preview, [])).toEqual([W2]);
    expect(text(h)).toContain(en["schedule.board.horizon.will_skip"].replace("{date}", "Mon, Nov 2"));
  });

  it("a cancelled password prompt keeps the preview and applies NOTHING; Tier B is asked before the post", async () => {
    const { runGuarded } = await import("@/components/schedule/horizon-flow-shared");
    const post = vi.fn(async () => ({ ok: true as const, data: {} }));
    const cancelled = await runGuarded({ tier: "B", requestStepUp: async () => "cancelled", post });
    expect(cancelled).toEqual({ kind: "cancelled" });
    expect(post).not.toHaveBeenCalled();
    const order: string[] = [];
    const ok = await runGuarded({ tier: "B", requestStepUp: async () => { order.push("password"); return "ok"; }, post: async () => { order.push("post"); return { ok: true, data: { result: 1 } }; } });
    expect(ok).toEqual({ kind: "ok", data: { result: 1 } });
    expect(order).toEqual(["password", "post"]);
    expect(await runGuarded({ tier: null, requestStepUp: async () => { throw new Error("no prompt"); }, post: async () => ({ ok: false, code: "preview_stale" }) })).toEqual({ kind: "refused", code: "preview_stale" });
    const src = readFileSync("components/schedule/HorizonBuilder.tsx", "utf8");
    expect(src).toContain('requestStepUp("B")');
  });

  it("Astra chunk F P2-3: the main Regenerate on an EDITED week uses the horizon's confirmation — the warning, then Tier B, then confirmEdited: true; cancel applies nothing", async () => {
    const { runRegenerate, regenerateBody } = await import("@/components/schedule/horizon-flow-shared");
    const { SCHEDULE_ACTIONS } = await import("@/lib/scheduling/route-shapes-shared");
    // Not edited: one post, confirmEdited false, no warning, no password.
    const order: string[] = [];
    const plain = await runRegenerate({ edited: false, confirm: async () => { order.push("confirm"); return true; }, requestStepUp: async () => { order.push("password"); return "ok"; },
      post: async (c) => { order.push(`post:${c}`); return { ok: true, data: {} }; } });
    expect(plain).toEqual({ kind: "ok", data: {} });
    expect(order).toEqual(["post:false"]);
    // Edited, the warning cancelled: nothing posted, no password asked.
    const post = vi.fn(async () => ({ ok: true as const, data: {} }));
    const step = vi.fn(async () => "ok" as const);
    expect(await runRegenerate({ edited: true, confirm: async () => false, requestStepUp: step, post })).toEqual({ kind: "cancelled" });
    expect(post).not.toHaveBeenCalled();
    expect(step).not.toHaveBeenCalled();
    // Edited, the password cancelled: nothing posted.
    expect(await runRegenerate({ edited: true, confirm: async () => true, requestStepUp: async () => "cancelled", post })).toEqual({ kind: "cancelled" });
    expect(post).not.toHaveBeenCalled();
    // Edited, confirmed: warning → password → post with confirmEdited TRUE.
    const seq: string[] = [];
    await runRegenerate({ edited: true, confirm: async () => { seq.push("confirm"); return true; }, requestStepUp: async () => { seq.push("password"); return "ok"; },
      post: async (c) => { seq.push(`post:${c}`); return { ok: true, data: {} }; } });
    expect(seq).toEqual(["confirm", "password", "post:true"]);
    const body = regenerateBody("L", DATES[0]!, "h1", true);
    expect(body).toEqual({ action: "generate", locationId: "L", weekStart: DATES[0]!, expectedHead: "h1", confirmEdited: true });
    expect(Object.keys(body).sort()).toEqual([...SCHEDULE_ACTIONS.generate!].sort());
    // The board's button goes through it, with the literal Tier B prompt and the horizon's own warning text.
    const src = readFileSync("components/schedule/ScheduleBoard.tsx", "utf8");
    expect(src).toContain("runRegenerate(");
    expect(src).toContain('requestStepUp("B")');
    expect(src).not.toMatch(/confirmEdited: false/);
    const html = renderBoard(ready({ week: { ...boardSource().week!, edited: true } }));
    expect(html).toMatch(/<button[^>]*data-act="regenerate"[^>]*data-edited="true"|<button[^>]*data-edited="true"[^>]*data-act="regenerate"/);
  });

  it("preview_stale says preview again; a partial result names the landed, skipped and failed weeks", async () => {
    expect(text(await H({ initialPreview: preview, initialError: "preview_stale" }))).toContain(en["schedule.board.horizon.preview_again"]);
    const t = text(await H({ initialResult: { landed: [{ weekStart: W1, revisionId: "r" }], skipped: [{ weekStart: W2, code: "edited_week_unconfirmed" }], failed: { weekStart: "2026-11-09", code: "history_changed" }, horizonRunId: "x" } }));
    expect(t).toContain(en["schedule.board.horizon.landed"].replace("{date}", "Mon, Oct 26"));
    expect(t).toContain(en["schedule.board.horizon.skipped"].replace("{date}", "Mon, Nov 2"));
    expect(t).toContain(en["schedule.board.horizon.failed"].replace("{date}", "Mon, Nov 9"));
    expect(t).toContain(en["schedule.error.history_changed"]);
  });

  it("Approve (Tier B) is disabled WITH its reason while rules fail or an unresolved gap remains; allowed otherwise; approved says Ready for 7shifts and offers no send", async () => {
    const { ApproveBar } = await import("@/components/schedule/HorizonBuilder");
    const A = (approve: { allowed: boolean; refusal: string | null }, week: { headRevisionId: string; approved: boolean; edited: boolean } | null = { headRevisionId: "h1", approved: false, edited: false }) =>
      renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: createElement(StepUpProvider, { unlocked: false, unlockedAt: null,
        children: createElement(ApproveBar, { locationId: "L", weekStart: W1, week, approve }) as ReactNode }) }));
    const blocked = A({ allowed: false, refusal: "unresolved_gaps" });
    expect(blocked).toMatch(/<button[^>]*data-act="approve"[^>]*disabled=""/);
    expect(text(blocked)).toContain(en["schedule.error.unresolved_gaps"]);
    expect(text(A({ allowed: false, refusal: "rules_failing" }))).toContain(en["schedule.error.rules_failing"]);
    const ok = A({ allowed: true, refusal: null });
    expect(ok).toMatch(/<button[^>]*data-act="approve"/);
    expect(ok).not.toMatch(/<button[^>]*data-act="approve"[^>]*disabled=""/);
    const done = A({ allowed: false, refusal: "approved" }, { headRevisionId: "h1", approved: true, edited: false });
    expect(text(done)).toContain(en["schedule.board.ready_for_7shifts"]);
    expect(done).not.toMatch(/<button[^>]*>[^<]*(Send|7shifts)[^<]*<\/button>/i);
    expect(text(A({ allowed: false, refusal: "forbidden" }))).not.toContain(en["schedule.board.approve.button"]);
    const src = readFileSync("components/schedule/HorizonBuilder.tsx", "utf8");
    expect(src).toMatch(/approveBody\(/);
    const { approveBody } = await import("@/components/schedule/horizon-flow-shared");
    const { SCHEDULE_ACTIONS } = await import("@/lib/scheduling/route-shapes-shared");
    expect(Object.keys(approveBody("L", W1, "h1")).sort()).toEqual([...SCHEDULE_ACTIONS.approve!].sort());
  });
});

describe("Task 20 — the hub entry mirrors who may open the board", () => {
  it("GM, AGM, MoO and up see the Schedule card; the social media, catering and prep managers and a key holder never", async () => {
    const { adminSectionsFor } = await import("@/lib/admin/sections");
    const has = (level: number, role: Parameters<typeof adminSectionsFor>[1]) => adminSectionsFor(level, role).some((x) => x.id === "schedule" && x.href === "/schedule");
    expect([has(7, "gm"), has(6, "agm"), has(8, "moo"), has(9, "owner"), has(10, "cgs")]).toEqual([true, true, true, true, true]);
    expect([has(6, "social_media_mgr"), has(6, "catering_mgr"), has(6, "prep_mgr"), has(4, "key_holder")]).toEqual([false, false, false, false]);
  });
});

describe("Task 20 — en + es parity, 44 px, no shop-code literal", () => {
  const files = ["components/schedule", "lib/scheduling"].flatMap((d) => readdirSync(d).filter((f) => /\.(tsx|ts)$/.test(f)).map((f) => `${d}/${f}`));
  const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
  it("every schedule.* key the board renders exists in en AND es; es uses tú", () => {
    const keys = [...new Set(src.match(/"schedule\.(page|board|labor|budget|gap|note|reason|rule|diff|error|settings)\.[a-z0-9_.]+"/g)?.map((k) => k.slice(1, -1)) ?? [])];
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      if (k.endsWith(".")) continue; // a prefix the code completes with a closed union
      expect((en as Record<string, string>)[k], k).toBeTruthy();
      expect((es as Record<string, string>)[k], k).toBeTruthy();
    }
    for (const k of Object.keys(es).filter((x) => x.startsWith("schedule.page.") || x.startsWith("schedule.board."))) {
      expect((es as Record<string, string>)[k], k).not.toMatch(/\busted\b/i);
    }
  });
  it("the en and es renders carry the same structure (same tags, same count of buttons)", () => {
    const a = renderBoard(ready());
    const b = renderBoard(ready(), "es");
    expect((b.match(/<button/g) ?? []).length).toBe((a.match(/<button/g) ?? []).length);
    expect(text(b)).toContain(es["schedule.board.money.hours_vs_budget"]);
  });
  it("never keys on a shop code", () => {
    expect(readdirSync("components/schedule").map((f) => readFileSync(`components/schedule/${f}`, "utf8")).join("\n")).not.toMatch(/["'](EM|MEP)["']/);
  });
});

describe("Juan 2026-10-16 (decision 4): the strip names each salaried manager's week — base + flex (CC chunk H9: and what the flex covered)", () => {
  it("en + es, AGM included (hours only, no money)", () => {
    const view = ready();
    const uid = Object.keys(view.names)[0]!;
    const strip0 = view.strip!;
    const forced = { ...view, strip: { ...strip0, hours: { ...strip0.hours, salariedWeeks: [{ userId: uid, baseHours: 40, flexHours: 3.5, flexStationHours: 3.5, flexModHours: 0, flexSavedHours: 3.5, targetHours: 40, flexLimitHours: 10 }] } } };
    const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(p[k]));
    expect(en["schedule.board.money.salaried_week_base"]).toBe("{name}: {base} h");
    for (const [lang, L] of [["en", en], ["es", es]] as const) {
      const strip = renderBoard(forced, lang).match(/<section[^>]*data-section="strip"[\s\S]*?<\/section>/)![0];
      expect(text(strip)).toContain(fill(L["schedule.board.money.salaried_week_base"], { name: view.names[uid]!, base: 40 }));
      expect(text(strip)).toContain(fill(L["schedule.board.money.salaried_flex_station"], { hours: 3.5, saved: 3.5 }));
    }
  });
});

describe("CC addendum A (2026-10-16): the 40 h is a target — a hand-scheduled week past it reads \"{name}: 48 h, 8 h over the 40 h target\"", () => {
  it("en + es; a week at or under the target keeps the flex line", () => {
    const view = ready();
    const uid = Object.keys(view.names)[0]!;
    const strip0 = view.strip!;
    const forced = { ...view, strip: { ...strip0, hours: { ...strip0.hours, salariedWeeks: [{ userId: uid, baseHours: 48, flexHours: 0, flexStationHours: 0, flexModHours: 0, flexSavedHours: 0, targetHours: 40, flexLimitHours: 10 }] } } };
    const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(p[k]));
    expect(en["schedule.board.money.salaried_over_target"]).toBe("{name}: {hours} h, {over} h over the {target} h target");
    for (const [lang, L] of [["en", en], ["es", es]] as const) {
      const strip = renderBoard(forced, lang).match(/<section[^>]*data-section="strip"[\s\S]*?<\/section>/)![0];
      expect(text(strip)).toContain(fill(L["schedule.board.money.salaried_over_target"], { name: view.names[uid]!, hours: 48, over: 8, target: 40 }));
      // CC chunk H9: the over-target line REPLACES the base + flex line (the li holds exactly it).
      const li = strip.match(/<li[^>]*data-salaried-week[^>]*>([\s\S]*?)<\/li>/)![1]!;
      expect(text(li).trim()).toBe(fill(L["schedule.board.money.salaried_over_target"], { name: view.names[uid]!, hours: 48, over: 8, target: 40 }));
    }
  });
});


it("labels manager-set availability without claiming it was assumed from Toast", () => {
  const source = structuredClone(boardSource());
  for (const person of Object.values(source.week!.people)) {
    for (const window of Object.values(person.availability)) if (window) window.source = "manager_set";
  }
  const view = boardView(source);
  expect(view.banners.some((b) => b.id === "manager_set_availability")).toBe(true);
  expect(view.banners.some((b) => b.id === "assumed_availability")).toBe(false);
  const rows = view.days.flatMap((d) => d.rows).filter((r) => r.shifts.length > 0);
  expect(rows.some((r) => r.managerSetAvailability)).toBe(true);
  expect(rows.every((r) => !r.assumedAvailability)).toBe(true);
  for (const language of ["en", "es"] as const) {
    const dict = language === "en" ? en : es;
    expect(text(renderBoard({ state: "ready", ...view }, language))).toContain(dict["schedule.board.flag.manager_set_availability"]);
  }
});
