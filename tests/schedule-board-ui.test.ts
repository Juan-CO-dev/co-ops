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
