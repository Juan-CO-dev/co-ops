/**
 * Nav PR 8: "Needs you" (plan r2 2.6; spec 3.7 group 9; lead rulings r1 Q6, Q10, A8).
 * - It counts `nobody` holders only (now or urgent); a named holder is not counted.
 * - Under `own_tasks` and failed assignments the tasks row is "Couldn't load who has it", the line reads "at least", and
 *   the line is never "nothing" or 0 then.
 * - A failed source is named; "Nothing needs you" only when every source loaded and every count is 0.
 * - A company-wide reader's unplaced inbox work is its own line; a GM gets the shop's only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { NeedsYou } from "@/components/dashboard/NeedsYou";
import type { NeedsYouCells } from "@/lib/dashboard-blocks";
import { assignmentsKnown, needsYouTasks } from "@/lib/dashboard-blocks-shared";
import { aggregateFailure } from "@/lib/dashboard-day-shared";
import { planDay, type DayPlan, type DayPlanInput, type ShopFacts } from "@/lib/day-plan-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { GM, MOO, assignment, hm, ok, PLAN_DATE, withFailed } from "./fixtures/day-plan/build";
import { pStreet } from "./fixtures/day-plan/p-street";
import { text } from "./helpers/day-render";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;
const SHOP = "11111111-1111-4111-8111-111111111111";
const cells = (o: Partial<NeedsYouCells> = {}): NeedsYouCells => ({ vendorMail: { kind: "ok", value: 0 }, recipes: { kind: "ok", value: 0 }, inbox: { kind: "ok", value: { shop: 0, unplaced: 0 } }, ...o });
function input(t: string, facts: ShopFacts): DayPlanInput { return { planDate: PLAN_DATE, nowMin: hm(t), viewer: GM, facts }; }
function render(inp: DayPlanInput, c: NeedsYouCells, language: "en" | "es" = "en") {
  const plan = planDay(inp) as DayPlan;
  const tasksKnown = assignmentsKnown(inp) && !aggregateFailure(plan);
  return { plan, html: renderToStaticMarkup(createElement(NeedsYou, { cells: c, plan, tasksKnown, shopId: SHOP, language })) };
}
/** Nobody holds AM prep or the cash deposit at 20:30 (both now at night). */
const NIGHT = "20:30";
const facts = (rows = [assignment("as-open", "opening_report", "u-ana", "Ana")]): ShopFacts => ({ ...pStreet(hm(NIGHT)), assignments: ok({ forDate: PLAN_DATE, scope: "all_tasks", rows }) });

describe("group 9: tasks with nobody on them", () => {
  it("counts nobody only; a named holder is not counted", () => {
    const { plan, html } = render(input(NIGHT, facts()), cells());
    const nobody = needsYouTasks(plan);
    expect(nobody.length).toBeGreaterThan(0);
    expect(nobody.every((i) => i.holder.kind === "nobody" && (i.band === "now" || i.band === "urgent"))).toBe(true);
    expect(html).toContain('data-needs-you-line="count"');
    expect(text(html)).toContain(EN[nobody.length === 1 ? "dashboard.needs_you.tasks_one" : "dashboard.needs_you.tasks_other"]!.replace("{n}", String(nobody.length)));
    const named = render(input(NIGHT, facts([assignment("a1", "am_prep", "u-x", "Xi"), assignment("a2", "cash_report", "u-y", "Yo"), assignment("a3", "pm_report", "u-z", "Zed")])), cells());
    expect(needsYouTasks(named.plan).map((i) => i.id)).not.toContain("am_prep");
  });
  it.each([
    ["own_tasks", (f: ShopFacts) => ({ ...f, assignments: ok({ forDate: PLAN_DATE, scope: "own_tasks" as const, rows: [] }) })],
    ["failed assignments", (f: ShopFacts) => withFailed(f, ["assignments"])],
    ["another day's assignments", (f: ShopFacts) => ({ ...f, assignments: ok({ forDate: "2026-11-17", scope: "all_tasks" as const, rows: [] }) })],
  ] as const)("%s: the tasks row is Couldn't load who has it, the line reads at least, never 0", (_n, patch) => {
    for (const lang of ["en", "es"] as const) {
      const L = lang === "en" ? EN : ES;
      const { html } = render(input(NIGHT, patch(facts())), cells(), lang);
      expect(html).toContain('data-needs-you-line="at_least"');
      expect(text(html)).toContain(L["dashboard.day.holder_unknown"]);
      expect(text(html)).toContain(L["dashboard.needs_you.summary_at_least"]!.replace("{n}", "0"));
      expect(text(html)).not.toContain(L["dashboard.needs_you.none"]);
    }
  });
  it("under day.fail.all: tasks unknown, at least", () => {
    const all = withFailed(facts(), ["hours", "stations", "opening", "closing", "amPrep", "midDay", "cash", "pm", "ordering", "rhythm", "receiving",
      "cateringToday", "cateringTomorrow", "flaggedLines", "yesterdayClosing"]);
    const { html } = render(input(NIGHT, all), cells());
    expect(html).toContain('data-needs-you-line="at_least"');
    expect(text(html)).toContain(EN["dashboard.day.holder_unknown"]);
  });
});

describe("the line and the rows", () => {
  const quiet = (): ShopFacts => ({ ...pStreet(hm("06:00")), assignments: ok({ forDate: PLAN_DATE, scope: "all_tasks", rows:
    (["opening_report", "receiving", "ordering", "am_prep", "cash_report", "pm_report", "mid_day_prep", "counts"] as const).map((task, i) => assignment(`q${i}`, task, `u-${i}`, `P${i}`)) }) });
  it("nothing anywhere: Nothing needs you right now.", () => {
    const { plan, html } = render(input("06:00", quiet()), cells());
    expect(needsYouTasks(plan)).toEqual([]);
    expect(html).toContain('data-needs-you-line="none"');
    expect(text(html)).toContain(EN["dashboard.needs_you.none"]);
  });
  it("counts summed: vendor mail 2 + recipes 1 + inbox 3 (+1 unplaced) = 7, each row with its link", () => {
    const { html } = render(input("06:00", quiet()), cells({ vendorMail: { kind: "ok", value: 2 }, recipes: { kind: "ok", value: 1 }, inbox: { kind: "ok", value: { shop: 3, unplaced: 1 } } }));
    expect(text(html)).toContain(EN["dashboard.needs_you.summary"]!.replace("{n}", "7"));
    expect(html).toContain(`href="/operations/vendor-mail?location=${SHOP}&amp;stale=1"`);
    expect(html).toContain(`href="/admin/catalog/notices?location=${SHOP}"`);
    expect(html).toContain('href="/catering/inbox"');
    expect(text(html)).toContain(EN["dashboard.needs_you.inbox_unplaced"]!.replace("{n}", "1"));
    expect(html).toMatch(/<summary[^>]*min-h-\[44px\][^"]*items-center/);
    expect(html).not.toMatch(/<details[^>]*open/);
  });
  it("a GM (unplaced null): no unplaced line", () => {
    const { html } = render(input("06:00", quiet()), cells({ inbox: { kind: "ok", value: { shop: 2, unplaced: null } } }));
    expect(html).not.toContain('data-needs-you="inbox_unplaced"');
    expect(text(html)).toContain(EN["dashboard.needs_you.summary"]!.replace("{n}", "2"));
  });
  it.each([["vendorMail", "vendorMail.title"], ["recipes", "catalog.notices.title"], ["inbox", "catering.inbox.title"]] as const)("%s failed: named, the line at least", (key, name) => {
    for (const lang of ["en", "es"] as const) {
      const L = lang === "en" ? EN : ES;
      const { html } = render(input("06:00", quiet()), cells({ [key]: { kind: "timed_out" }, ...(key === "vendorMail" ? {} : { vendorMail: { kind: "ok", value: 4 } }) }), lang);
      expect(text(html)).toContain(L["dashboard.needs_you.unavailable"]!.replace("{name}", L[name]!));
      expect(html).toContain('data-needs-you-line="at_least"');
    }
  });
  it("a source the role does not read (null) has no row and does not make the line at least", () => {
    const { html } = render(input("06:00", quiet()), cells({ recipes: null, vendorMail: null }));
    expect(html).toContain('data-needs-you-line="none"');
    void MOO;
  });
});
