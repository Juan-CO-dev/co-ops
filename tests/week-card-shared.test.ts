/**
 * Unit spine — "This week in CO-OPS" (B11a-admin), the pure surface that replaced the
 * "Used this week" adoption card. The owner's complaint was that the old card was
 * "super inaccurate to how the app actually works": it showed 1 checklist for a week with
 * 196 lines ticked and 0 catering for a week with 305 leads (all made by the scan). These
 * tests pin the decisions that make the new numbers honest: people vs automatic, the role
 * bands, the shop columns, and what "finished" means.
 */
import { describe, it, expect } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import {
  actionCountsAsUse,
  arrivedSource,
  buildWeekCard,
  cellIsZero,
  checklistKind,
  checklistOutcome,
  ranAllWeek,
  roleBand,
  toastRunResult,
  WEEK_DETAIL_AREAS,
  WEEK_SUMMARY_AREAS,
  weekHasJobAlert,
  weekBusinessDays,
  weekHasPeopleActivity,
  weekWindowStart,
  type WeekCardInput,
} from "@/lib/admin/week-card-shared";
import { ROLES } from "@/lib/roles";

const P = "loc-p";
const C = "loc-c";
const OTHER = "loc-other";
const DAYS = ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"];

function input(over: Partial<WeekCardInput> = {}): WeekCardInput {
  return {
    since: "2026-10-08T12:00:00.000Z",
    shops: [
      { id: P, name: "Shop P" },
      { id: C, name: "Shop C" },
    ],
    allShopsViewer: true,
    actors: [],
    checklists: [],
    lineLocations: [],
    pmReportLocations: [],
    cashReportLocations: [],
    orderLocations: [],
    deliveryLocations: [],
    countLocations: [],
    leads: [],
    quotes: [],
    ezcaterArrivedLocations: [],
    ezcaterSyncs: [],
    businessDays: DAYS,
    toastRuns: [],
    depletionRuns: [],
    ...over,
  };
}

const shop = (card: ReturnType<typeof buildWeekCard>, id: string) => card.shops.find((s) => s.shopId === id)!;

describe("window", () => {
  it("opens exactly 7 days before now", () => {
    expect(weekWindowStart(new Date("2026-10-15T12:00:00.000Z"))).toBe("2026-10-08T12:00:00.000Z");
  });
});

describe("roleBand — lib/roles.ts levels", () => {
  it("crew ≤ 3, key holders & leads 4–5, managers 6+", () => {
    expect(roleBand(ROLES.employee.level)).toBe("crew");
    expect(roleBand(ROLES.trainee.level)).toBe("crew");
    expect(roleBand(ROLES.key_holder.level)).toBe("leads");
    expect(roleBand(ROLES.trainer.level)).toBe("leads");
    expect(roleBand(ROLES.shift_lead.level)).toBe("leads");
    expect(roleBand(ROLES.agm.level)).toBe("managers");
    expect(roleBand(ROLES.social_media_mgr.level)).toBe("managers");
    expect(roleBand(ROLES.gm.level)).toBe("managers");
    expect(roleBand(ROLES.cgs.level)).toBe("managers");
  });
});

describe("actionCountsAsUse — a failed sign-in is not use", () => {
  it("counts every lifecycle action and the auth successes", () => {
    for (const a of ["checklist_completion.create", "cash_report.submit", "auth_signin_pin_success", "auth_signin_password_success", "auth_step_up_success", "auth_logout"]) {
      expect(actionCountsAsUse(a)).toBe(true);
    }
  });
  it("does not count failures, lockouts, token refusals or a reset request", () => {
    for (const a of ["auth_signin_pin_failure", "auth_account_locked", "auth_token_expired", "auth_token_invalid", "auth_token_consumed_replay", "auth_password_reset_requested", "session_token_mismatch", "auth_step_up_failure"]) {
      expect(actionCountsAsUse(a)).toBe(false);
    }
  });
});

describe("checklists — kind and outcome", () => {
  it("maps template type + prep_subtype", () => {
    expect(checklistKind("opening", null)).toBe("opening");
    expect(checklistKind("closing", null)).toBe("closing");
    expect(checklistKind("prep", "am_prep")).toBe("am_prep");
    expect(checklistKind("prep", "mid_day_prep")).toBe("mid_day");
    expect(checklistKind("prep", null)).toBeNull();
  });
  it("finished = a person got it to the end; auto_finalized is the system's, not people's", () => {
    expect(checklistOutcome("confirmed")).toBe("finished");
    expect(checklistOutcome("incomplete_confirmed")).toBe("finished");
    expect(checklistOutcome("phase2_complete")).toBe("finished");
    expect(checklistOutcome("auto_finalized")).toBe("system_closed");
    expect(checklistOutcome("open")).toBe("in_progress");
    expect(checklistOutcome("phase1_complete")).toBe("in_progress");
  });
  it("tallies started / finished per kind and in total; dropped instances never count", () => {
    const card = buildWeekCard(input({
      checklists: [
        { locationId: P, type: "closing", prepSubtype: null, status: "incomplete_confirmed", dropped: false },
        { locationId: P, type: "closing", prepSubtype: null, status: "incomplete_confirmed", dropped: false },
        { locationId: P, type: "opening", prepSubtype: null, status: "open", dropped: false },
        { locationId: P, type: "prep", prepSubtype: "am_prep", status: "confirmed", dropped: false },
        { locationId: P, type: "opening", prepSubtype: null, status: "phase2_complete", dropped: true },
        { locationId: C, type: "closing", prepSubtype: null, status: "auto_finalized", dropped: false },
      ],
    }));
    const p = shop(card, P);
    expect(p.checklists.closing).toEqual({ started: 2, finished: 2, systemClosed: 0 });
    expect(p.checklists.opening).toEqual({ started: 1, finished: 0, systemClosed: 0 });
    expect(p.checklists.am_prep).toEqual({ started: 1, finished: 1, systemClosed: 0 });
    expect(p.checklistsTotal).toEqual({ started: 4, finished: 3, systemClosed: 0 });
    // the system-closed closing is started, NOT finished
    expect(shop(card, C).checklistsTotal).toEqual({ started: 1, finished: 0, systemClosed: 1 });
  });
});

describe("people — the membership rule", () => {
  it("counts each person once per shop they belong to and once overall, banded by level", () => {
    const card = buildWeekCard(input({
      actors: [
        { userId: "owner", level: 10, locationIds: [P, C] },
        { userId: "kh", level: 4, locationIds: [P] },
        { userId: "emp", level: 3, locationIds: [C] },
        { userId: "kh", level: 4, locationIds: [P] }, // duplicate actor → once
      ],
    }));
    expect(card.overallPeople).toBe(3);
    expect(shop(card, P).people).toEqual({ total: 2, crew: 0, leads: 1, managers: 1 });
    expect(shop(card, C).people).toEqual({ total: 2, crew: 1, leads: 0, managers: 1 });
  });
  it("a person with no membership counts overall only for an all-shops viewer", () => {
    const actors = [{ userId: "u", level: 9, locationIds: [] as string[] }];
    expect(buildWeekCard(input({ actors, allShopsViewer: true })).overallPeople).toBe(1);
    expect(buildWeekCard(input({ actors, allShopsViewer: false })).overallPeople).toBe(0);
  });
  it("a shop-bound viewer's overall line counts only people in the shops they see", () => {
    const card = buildWeekCard(input({
      shops: [{ id: P, name: "Shop P" }],
      allShopsViewer: false,
      actors: [
        { userId: "a", level: 3, locationIds: [P] },
        { userId: "b", level: 3, locationIds: [OTHER] },
      ],
    }));
    expect(card.overallPeople).toBe(1);
    expect(card.shops).toHaveLength(1);
  });
  it("an unrecognised role still counts as a person, in no band", () => {
    const card = buildWeekCard(input({ actors: [{ userId: "x", level: null, locationIds: [P] }] }));
    expect(shop(card, P).people).toEqual({ total: 1, crew: 0, leads: 0, managers: 0 });
  });
});

describe("catering — people and automatic never mix", () => {
  it("a lead with created_by NULL is the scan's, never somebody's work", () => {
    const card = buildWeekCard(input({
      leads: [
        { locationId: C, createdBy: null, leadSource: "toast_catering" },
        { locationId: C, createdBy: null, leadSource: "toast_catering" },
        { locationId: C, createdBy: null, leadSource: "ezcater" },
        { locationId: C, createdBy: null, leadSource: "portal" },
        { locationId: C, createdBy: "staff-1", leadSource: "phone" },
      ],
      quotes: [
        { locationId: C, createdBy: "staff-1" },
        { locationId: C, createdBy: null }, // a customer's self-serve quote
      ],
      ezcaterArrivedLocations: [C, C, P],
    }));
    const c = shop(card, C);
    expect(c.leadsByPeople).toBe(1);
    expect(c.quotesByPeople).toBe(1);
    // ezCater counts from ezcater_orders (2), NOT the ezcater lead too — one order, once
    expect(c.arrived).toEqual({ ezcater: 2, toastCatering: 2, other: 1, total: 5 });
    expect(shop(card, P).arrived.total).toBe(1);
  });
  it("arrivedSource buckets the lead_source registry", () => {
    expect(arrivedSource("ezcater")).toBe("ezcater");
    expect(arrivedSource("toast_catering")).toBe("toast_catering");
    expect(arrivedSource("portal")).toBe("other");
    expect(arrivedSource(null)).toBe("other");
  });
});

describe("automatic jobs", () => {
  it("toast runs: completed/modified_completed OK, failed failed, running neither", () => {
    expect(toastRunResult("completed")).toBe("ok");
    expect(toastRunResult("modified_completed")).toBe("ok");
    expect(toastRunResult("failed")).toBe("failed");
    expect(toastRunResult("running")).toBeNull();
  });
  it("the week's business days are the 7 ET dates ending today (an evening UTC instant is still ET today)", () => {
    // 2026-10-16T02:00Z is 10 PM EDT on the 15th.
    expect(weekBusinessDays(new Date("2026-10-16T02:00:00.000Z"))).toEqual(DAYS);
  });
  it("Toast health is DAYS with an OK run, not a run count; failures still counted", () => {
    const card = buildWeekCard(input({
      toastRuns: [
        // ~1,160 runs a shop a week in prod — many runs on one day is still ONE day
        ...DAYS.flatMap((d) => [1, 2, 3].map(() => ({ locationId: C, status: "completed", businessDate: d }))),
        { locationId: P, status: "completed", businessDate: "2026-10-14" },
        { locationId: P, status: "modified_completed", businessDate: "2026-10-15" },
        { locationId: P, status: "completed", businessDate: "2026-10-08" }, // before the 7 days
        { locationId: P, status: "failed", businessDate: "2026-10-13" }, // a failed run covers no day
        { locationId: P, status: "running", businessDate: "2026-10-12" },
      ],
    }));
    expect(shop(card, C).jobs).toMatchObject({ toastDaysRan: 7, toastDaysExpected: 7, toastPullsFailed: 0 });
    expect(shop(card, P).jobs).toMatchObject({ toastDaysRan: 2, toastDaysExpected: 7, toastPullsFailed: 1 });
    const row = WEEK_SUMMARY_AREAS.flatMap((a) => a.rows).find((r) => r.id === "toast")!;
    const c = row.cell(shop(card, C));
    const p = row.cell(shop(card, P));
    expect(c).toEqual({ kind: "days", ran: 7, of: 7, failed: 0 });
    expect(p).toEqual({ kind: "days", ran: 2, of: 7, failed: 1 });
    expect(ranAllWeek({ ran: 7, of: 7 })).toBe(true);
    expect(ranAllWeek({ ran: 6, of: 7 })).toBe(false);
    expect(ranAllWeek({ ran: 0, of: 0 })).toBe(false);
    expect(cellIsZero(p)).toBe(false);
    expect(weekHasJobAlert(card)).toBe(true);
  });
  it("tallies syncs and DISTINCT depletion days per shop", () => {
    const card = buildWeekCard(input({
      ezcaterSyncs: [
        { locationId: P, hasError: false },
        { locationId: P, hasError: true },
      ],
      depletionRuns: [
        { locationId: P, businessDate: "2026-10-10" },
        { locationId: P, businessDate: "2026-10-10" },
        { locationId: P, businessDate: "2026-10-11" },
        { locationId: C, businessDate: null },
      ],
    }));
    expect(shop(card, P).jobs).toMatchObject({ ezcaterSynced: 1, ezcaterSyncErrors: 1, depletionDays: 2 });
    expect(shop(card, C).jobs.depletionDays).toBe(0);
    expect(weekHasJobAlert(card)).toBe(true);
  });
  it("automatic work alone is not people activity", () => {
    const card = buildWeekCard(input({
      toastRuns: [{ locationId: P, status: "completed", businessDate: "2026-10-15" }],
      leads: [{ locationId: P, createdBy: null, leadSource: "toast_catering" }],
    }));
    expect(weekHasPeopleActivity(card)).toBe(false);
    expect(weekHasJobAlert(card)).toBe(false);
  });
});

describe("columns — a row never leaks into a column it does not belong to", () => {
  it("drops rows for other shops and NULL locations; counts the rest per shop", () => {
    const card = buildWeekCard(input({
      lineLocations: [P, P, C, OTHER],
      pmReportLocations: [P],
      cashReportLocations: [P, P],
      orderLocations: [C],
      deliveryLocations: [OTHER],
      countLocations: [C, C],
      leads: [{ locationId: null, createdBy: "s", leadSource: "phone" }],
      ezcaterArrivedLocations: [null],
    }));
    const p = shop(card, P);
    const c = shop(card, C);
    expect([p.linesTicked, p.pmReports, p.cashReports, p.ordersPlaced, p.deliveriesReceived, p.countsRecorded]).toEqual([2, 1, 2, 0, 0, 0]);
    expect([c.linesTicked, c.ordersPlaced, c.countsRecorded, c.deliveriesReceived, c.leadsByPeople]).toEqual([1, 1, 2, 0, 0]);
    expect(weekHasPeopleActivity(card)).toBe(true);
  });
  it("keeps the shops in the order given (the DB's order, never a literal)", () => {
    const card = buildWeekCard(input({ shops: [{ id: C, name: "Shop C" }, { id: P, name: "Shop P" }] }));
    expect(card.shops.map((s) => s.shopName)).toEqual(["Shop C", "Shop P"]);
  });
});

describe("rows — rendering contract", () => {
  const all = [...WEEK_SUMMARY_AREAS, ...WEEK_DETAIL_AREAS];

  it("every area and row label exists in BOTH en and es (translate-from-day-one)", () => {
    const keys = [
      ...all.flatMap((a) => [a.labelKey, ...a.rows.map((r) => r.labelKey)]),
      "admin.hub.week.ran_all",
      "admin.hub.week.ran_days",
      "admin.hub.week.failed_suffix",
    ];
    for (const k of keys) {
      expect(en, k).toHaveProperty([k]);
      expect(es, k).toHaveProperty([k]);
    }
  });

  it("row ids are unique across the card", () => {
    const ids = all.flatMap((a) => a.rows.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only automatic areas carry the automatic-job and arrived-catering rows", () => {
    const autoRowIds = new Set(all.filter((a) => a.automatic).flatMap((a) => a.rows.map((r) => r.id)));
    for (const id of ["arrived", "toast", "ezcater_ok", "ezcater_errors", "depletion", "arrived_ezcater", "arrived_toast", "arrived_other"]) {
      expect(autoRowIds.has(id), id).toBe(true);
    }
    const peopleRowIds = new Set(all.filter((a) => !a.automatic).flatMap((a) => a.rows.map((r) => r.id)));
    for (const id of autoRowIds) expect(peopleRowIds.has(id), id).toBe(false);
  });

  it("zero is muted; 'of' is muted only when nothing started; a failed job is an alert", () => {
    const card = buildWeekCard(input({
      checklists: [{ locationId: P, type: "opening", prepSubtype: null, status: "open", dropped: false }],
      ezcaterSyncs: [{ locationId: P, hasError: true }],
    }));
    const p = shop(card, P);
    const cellOf = (id: string) => all.flatMap((a) => a.rows).find((r) => r.id === id)!.cell(p);
    expect(cellOf("checklists")).toEqual({ kind: "of", done: 0, total: 1 });
    expect(cellIsZero(cellOf("checklists"))).toBe(false);
    expect(cellIsZero(cellOf("closing"))).toBe(true);
    expect(cellIsZero(cellOf("lines"))).toBe(true);
    expect(cellOf("ezcater_errors")).toEqual({ kind: "count", n: 1, alert: true });
    expect(cellOf("ezcater_ok")).toEqual({ kind: "count", n: 0, alert: false });
  });
});
