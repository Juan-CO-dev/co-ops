/**
 * "This week in CO-OPS" — the admin hub's weekly card, PURE surface (B11a-admin).
 * Client-safe, zero I/O, no server imports. lib/admin/week-card.ts does the reads and
 * hands the raw rows here; everything that DECIDES what a number means lives in this file
 * so it is testable (tests/week-card-shared.test.ts).
 *
 * WHY IT REPLACED "Used this week" (owner, 2026-10-15: "seems super inaccurate to how the
 * app actually works"). The old card counted a curated list of audit actions over the whole
 * business. It showed 1 checklist for a week with 126 lines ticked (it counted only
 * `checklist.confirm`), 0 catering for a week with 305 leads (they were all made by the
 * scan, actor NULL, and the card only knew quote actions), and nothing at all for cash,
 * sign-ins or the automatic jobs. This card:
 *
 *   - puts the shops SIDE BY SIDE (one column per active location the viewer may read; the
 *     locations come from the DB, never a literal);
 *   - counts from the SOURCE TABLE wherever a row IS the thing (a checklist instance, a
 *     cash report, a PO, a delivery, a count event, a lead, a quote), and from audit_log
 *     only where no table fits (who used the app; the nightly depletion job);
 *   - keeps PEOPLE and AUTOMATIC apart: a catering lead with `created_by` NULL was made by
 *     the ezCater / Toast scan and is never shown as somebody's work.
 *
 * THE PEOPLE RULE (location). audit_log has no location column and `metadata.location_id`
 * is sparse (prod, week of 2026-10-15: one key holder had 94 rows, 3 with a location). So a
 * person is counted under EVERY shop they hold an active membership at (`user_locations`),
 * and the card says so in a footnote. Someone at both shops shows in both columns; the
 * overall line counts each person once. A person with no membership (an all-shops role)
 * shows only in the overall line, and only to a viewer who can read every shop.
 *
 * THE PEOPLE RULE (who). A person "used CO-OPS" when they wrote at least one audit row in
 * the window that is not a failed or refused sign-in (`actionCountsAsUse`). Role band is the
 * person's CURRENT role level (lib/roles.ts): crew ≤ 3, key holders & leads 4–5, managers 6+.
 */
import type { TranslationKey } from "@/lib/i18n/types";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";

/** The look-back window: the last 7 days, ending now. */
export const WEEK_WINDOW_DAYS = 7;

/** ISO instant the window opens at (now − 7 days). Time enters as a parameter. */
export function weekWindowStart(now: Date): string {
  return new Date(now.getTime() - WEEK_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
}

/**
 * The 7 ET business days the window covers, oldest first, ending TODAY. The Toast pull
 * runs all day, every day, so this is the set of days it should have run on.
 */
export function weekBusinessDays(now: Date): string[] {
  const today = etCalendarDate(now.toISOString());
  return Array.from({ length: WEEK_WINDOW_DAYS }, (_, i) => etYmdMinusDays(today, WEEK_WINDOW_DAYS - 1 - i));
}

// ── People ─────────────────────────────────────────────────────────────────────

export type RoleBand = "crew" | "leads" | "managers";

/** Key holder / trainer (4) and shift lead (5) are the "key holders & leads" band. */
export const LEADS_MIN_LEVEL = 4;
/** AGM / catering / prep / social (6) and up are managers. */
export const MANAGERS_MIN_LEVEL = 6;

export function roleBand(level: number): RoleBand {
  if (level >= MANAGERS_MIN_LEVEL) return "managers";
  if (level >= LEADS_MIN_LEVEL) return "leads";
  return "crew";
}

/**
 * Does this audit action mean the person actually USED the app? Every lifecycle action
 * does. Of the flat auth/session namespace only the successes (and a logout, which
 * requires having been signed in) do — a failed PIN, a lockout, a replayed or expired
 * token, a reset REQUEST or a token mismatch is not use.
 */
export function actionCountsAsUse(action: string): boolean {
  if (action.startsWith("auth_") || action.startsWith("session_")) {
    return action.endsWith("_success") || action === "auth_logout";
  }
  return true;
}

/** One person who used the app in the window. `level` null = role not recognised. */
export interface WeekActor {
  userId: string;
  level: number | null;
  /** active `user_locations` memberships. */
  locationIds: readonly string[];
}

export interface PeopleTally {
  total: number;
  crew: number;
  leads: number;
  managers: number;
}

const NO_PEOPLE: PeopleTally = { total: 0, crew: 0, leads: 0, managers: 0 };

// ── Checklists ─────────────────────────────────────────────────────────────────

export type ChecklistKind = "opening" | "am_prep" | "mid_day" | "closing";
/** Shift order. */
export const CHECKLIST_KINDS: readonly ChecklistKind[] = ["opening", "am_prep", "mid_day", "closing"];

/** `checklist_templates.type` + `prep_subtype` (both CHECK-constrained) → the card's kind. */
export function checklistKind(type: string, prepSubtype: string | null): ChecklistKind | null {
  if (type === "opening") return "opening";
  if (type === "closing") return "closing";
  if (type === "prep") {
    if (prepSubtype === "am_prep") return "am_prep";
    if (prepSubtype === "mid_day_prep") return "mid_day";
  }
  return null;
}

export type ChecklistOutcome = "finished" | "system_closed" | "in_progress";

/**
 * `checklist_instances.status` (CHECK: open · phase1_complete · phase2_complete · confirmed ·
 * incomplete_confirmed · auto_finalized) → what a person achieved.
 *
 * FINISHED = a person got it to the end: `confirmed` (closing, AM prep), `incomplete_confirmed`
 * (a closing confirmed with lines open — still finished by a person), `phase2_complete` (where
 * openings and mid-day preps end today; Phase 3 is unwired — the same ruling as
 * FINALIZED_REPORT_STATUSES in lib/reports-hub.ts).
 * SYSTEM_CLOSED = `auto_finalized`: nobody confirmed it, the system closed it. Not people's
 * work, so it is never in "finished" — it gets its own detail line.
 */
export function checklistOutcome(status: string): ChecklistOutcome {
  if (status === "confirmed" || status === "incomplete_confirmed" || status === "phase2_complete") return "finished";
  if (status === "auto_finalized") return "system_closed";
  return "in_progress";
}

export interface ChecklistTally {
  started: number;
  finished: number;
  systemClosed: number;
}

// ── Catering ───────────────────────────────────────────────────────────────────

/**
 * Where an AUTOMATIC lead came from. ezCater leads are deliberately NOT counted from the
 * pipeline: the ezCater order itself (`ezcater_orders`) is the truer "an order arrived" row,
 * and counting both would show one order twice.
 */
export type ArrivedSource = "toast_catering" | "other";

export function arrivedSource(leadSource: string | null): ArrivedSource | "ezcater" {
  if (leadSource === "ezcater") return "ezcater";
  if (leadSource === "toast_catering") return "toast_catering";
  return "other";
}

// ── Automatic jobs ─────────────────────────────────────────────────────────────

/**
 * `toast_capture_runs.status` (CHECK: running · completed · failed · modified_completed).
 * A run still `running` is neither yet.
 */
export function toastRunResult(status: string): "ok" | "failed" | null {
  if (status === "completed" || status === "modified_completed") return "ok";
  if (status === "failed") return "failed";
  return null;
}

// ── The card ───────────────────────────────────────────────────────────────────

export interface ShopWeek {
  shopId: string;
  shopName: string;
  people: PeopleTally;
  checklists: Record<ChecklistKind, ChecklistTally>;
  checklistsTotal: ChecklistTally;
  linesTicked: number;
  pmReports: number;
  cashReports: number;
  ordersPlaced: number;
  deliveriesReceived: number;
  countsRecorded: number;
  leadsByPeople: number;
  quotesByPeople: number;
  arrived: { ezcater: number; toastCatering: number; other: number; total: number };
  jobs: {
    /**
     * Business days (of `toastDaysExpected`) with at least one OK Toast run. The pull runs
     * all day (~1,160 runs a shop a week), so a run COUNT is noise; days covered is the
     * health signal. Failed runs are still counted, as the alert.
     */
    toastDaysRan: number;
    toastDaysExpected: number;
    toastPullsFailed: number;
    ezcaterSynced: number;
    ezcaterSyncErrors: number;
    depletionDays: number;
  };
}

export interface WeekCard {
  /** ISO start of the window. */
  since: string;
  /** distinct people across what the viewer may see (each person once). */
  overallPeople: number;
  shops: ShopWeek[];
}

/** Everything the loader read, already narrowed to the window (see lib/admin/week-card.ts). */
export interface WeekCardInput {
  since: string;
  /** the columns, in display order — active locations the viewer may read. */
  shops: ReadonlyArray<{ id: string; name: string }>;
  /** true when the viewer reads every shop (level 8+): unaffiliated people join the overall line. */
  allShopsViewer: boolean;
  actors: ReadonlyArray<WeekActor>;
  /** checklist instances CREATED in the window. */
  checklists: ReadonlyArray<{ locationId: string; type: string; prepSubtype: string | null; status: string; dropped: boolean }>;
  /** live, person-ticked completion lines in the window (one entry per line → its shop). */
  lineLocations: ReadonlyArray<string>;
  /** live PM reports submitted in the window. */
  pmReportLocations: ReadonlyArray<string>;
  /** live cash reports entered in the window. */
  cashReportLocations: ReadonlyArray<string>;
  /** POs placed in the window. */
  orderLocations: ReadonlyArray<string>;
  /** vendor deliveries logged in the window. */
  deliveryLocations: ReadonlyArray<string>;
  /** active count events recorded in the window. */
  countLocations: ReadonlyArray<string>;
  /** catering leads created in the window. */
  leads: ReadonlyArray<{ locationId: string | null; createdBy: string | null; leadSource: string | null }>;
  /** catering quotes (every version) created in the window. */
  quotes: ReadonlyArray<{ locationId: string | null; createdBy: string | null }>;
  /** ezCater orders first seen in the window. */
  ezcaterArrivedLocations: ReadonlyArray<string | null>;
  /** ezCater orders whose latest sync attempt fell in the window. */
  ezcaterSyncs: ReadonlyArray<{ locationId: string | null; hasError: boolean }>;
  /** the window's ET business days (weekBusinessDays) — what "ran all week" is measured against. */
  businessDays: ReadonlyArray<string>;
  /** Toast capture runs started in the window. */
  toastRuns: ReadonlyArray<{ locationId: string; status: string; businessDate: string | null }>;
  /** `toast_depletion.materialize` audit rows in the window (resource = the location). */
  depletionRuns: ReadonlyArray<{ locationId: string | null; businessDate: string | null }>;
}

function emptyChecklists(): Record<ChecklistKind, ChecklistTally> {
  return {
    opening: { started: 0, finished: 0, systemClosed: 0 },
    am_prep: { started: 0, finished: 0, systemClosed: 0 },
    mid_day: { started: 0, finished: 0, systemClosed: 0 },
    closing: { started: 0, finished: 0, systemClosed: 0 },
  };
}

function emptyShop(id: string, name: string): ShopWeek {
  return {
    shopId: id,
    shopName: name,
    people: { ...NO_PEOPLE },
    checklists: emptyChecklists(),
    checklistsTotal: { started: 0, finished: 0, systemClosed: 0 },
    linesTicked: 0,
    pmReports: 0,
    cashReports: 0,
    ordersPlaced: 0,
    deliveriesReceived: 0,
    countsRecorded: 0,
    leadsByPeople: 0,
    quotesByPeople: 0,
    arrived: { ezcater: 0, toastCatering: 0, other: 0, total: 0 },
    jobs: { toastDaysRan: 0, toastDaysExpected: 0, toastPullsFailed: 0, ezcaterSynced: 0, ezcaterSyncErrors: 0, depletionDays: 0 },
  };
}

/**
 * Shape the raw reads into the card. A row whose location is not one of the viewer's
 * columns (another shop, or NULL) is dropped — it never leaks into a column it does not
 * belong to.
 */
export function buildWeekCard(input: WeekCardInput): WeekCard {
  const byId = new Map<string, ShopWeek>();
  for (const s of input.shops) byId.set(s.id, emptyShop(s.id, s.name));
  const at = (id: string | null): ShopWeek | undefined => (id == null ? undefined : byId.get(id));
  const bump = (ids: ReadonlyArray<string | null>, field: "linesTicked" | "pmReports" | "cashReports" | "ordersPlaced" | "deliveriesReceived" | "countsRecorded") => {
    for (const id of ids) {
      const s = at(id);
      if (s) s[field] += 1;
    }
  };

  // People — each person once per shop they belong to; once overall.
  const seen = new Set<string>();
  let overall = 0;
  for (const a of input.actors) {
    if (seen.has(a.userId)) continue;
    seen.add(a.userId);
    const shops = [...new Set(a.locationIds)].map((id) => byId.get(id)).filter((s): s is ShopWeek => s != null);
    if (shops.length > 0 || input.allShopsViewer) overall += 1;
    for (const s of shops) {
      s.people.total += 1;
      if (a.level != null) s.people[roleBand(a.level)] += 1;
    }
  }

  for (const c of input.checklists) {
    if (c.dropped) continue;
    const s = at(c.locationId);
    const kind = checklistKind(c.type, c.prepSubtype);
    if (!s || !kind) continue;
    const outcome = checklistOutcome(c.status);
    for (const t of [s.checklists[kind], s.checklistsTotal]) {
      t.started += 1;
      if (outcome === "finished") t.finished += 1;
      if (outcome === "system_closed") t.systemClosed += 1;
    }
  }

  bump(input.lineLocations, "linesTicked");
  bump(input.pmReportLocations, "pmReports");
  bump(input.cashReportLocations, "cashReports");
  bump(input.orderLocations, "ordersPlaced");
  bump(input.deliveryLocations, "deliveriesReceived");
  bump(input.countLocations, "countsRecorded");

  for (const l of input.leads) {
    const s = at(l.locationId);
    if (!s) continue;
    if (l.createdBy != null) {
      s.leadsByPeople += 1;
      continue;
    }
    const src = arrivedSource(l.leadSource);
    if (src === "toast_catering") s.arrived.toastCatering += 1;
    else if (src === "other") s.arrived.other += 1;
    // src === "ezcater": counted from ezcater_orders below, never twice.
  }
  for (const q of input.quotes) {
    const s = at(q.locationId);
    if (s && q.createdBy != null) s.quotesByPeople += 1;
  }
  for (const id of input.ezcaterArrivedLocations) {
    const s = at(id);
    if (s) s.arrived.ezcater += 1;
  }
  for (const s of byId.values()) s.arrived.total = s.arrived.ezcater + s.arrived.toastCatering + s.arrived.other;

  for (const e of input.ezcaterSyncs) {
    const s = at(e.locationId);
    if (!s) continue;
    if (e.hasError) s.jobs.ezcaterSyncErrors += 1;
    else s.jobs.ezcaterSynced += 1;
  }
  // Toast: which of the window's business days had an OK run, per shop; failures counted.
  const expected = new Set(input.businessDays);
  const ranOn = new Map<string, Set<string>>();
  for (const r of input.toastRuns) {
    const s = at(r.locationId);
    const result = toastRunResult(r.status);
    if (!s || !result) continue;
    if (result === "failed") {
      s.jobs.toastPullsFailed += 1;
      continue;
    }
    if (r.businessDate == null || !expected.has(r.businessDate)) continue;
    const set = ranOn.get(r.locationId) ?? new Set<string>();
    set.add(r.businessDate);
    ranOn.set(r.locationId, set);
  }
  for (const s of byId.values()) {
    s.jobs.toastDaysExpected = expected.size;
    s.jobs.toastDaysRan = ranOn.get(s.shopId)?.size ?? 0;
  }
  // Depletion: DISTINCT business days per shop (the job re-runs a day several times).
  const days = new Map<string, Set<string>>();
  for (const d of input.depletionRuns) {
    if (!at(d.locationId) || d.businessDate == null || d.locationId == null) continue;
    const set = days.get(d.locationId) ?? new Set<string>();
    set.add(d.businessDate);
    days.set(d.locationId, set);
  }
  for (const [id, set] of days) byId.get(id)!.jobs.depletionDays = set.size;

  return { since: input.since, overallPeople: overall, shops: input.shops.map((s) => byId.get(s.id)!) };
}

// ── Rows (what the card renders, in order) ─────────────────────────────────────

/**
 * One cell. `of` renders "{done} of {total}"; `alert` renders as a never-collapse danger
 * value (D2). `days` is a job's health line: "Ran all week" / "Ran {ran} of {of} days",
 * plus "· {failed} failed" in the danger text role when any run failed.
 */
export type WeekCell =
  | { kind: "count"; n: number; alert?: boolean }
  | { kind: "of"; done: number; total: number }
  | { kind: "days"; ran: number; of: number; failed: number };

export interface WeekRow {
  id: string;
  labelKey: TranslationKey;
  cell: (s: ShopWeek) => WeekCell;
}

export interface WeekArea {
  id: string;
  labelKey: TranslationKey;
  /** automatic rows are labelled as such and never mixed into people's numbers. */
  automatic: boolean;
  rows: readonly WeekRow[];
}

const count = (n: number, alert = false): WeekCell => ({ kind: "count", n, alert: alert && n > 0 });
const of = (t: ChecklistTally): WeekCell => ({ kind: "of", done: t.finished, total: t.started });

/** Muted zero: a count of 0, or "of" with nothing started. "0 of 3" is a signal, not a zero;
 *  a job that missed days is a signal too, so a `days` cell is never muted. */
export function cellIsZero(c: WeekCell): boolean {
  if (c.kind === "count") return c.n === 0;
  if (c.kind === "of") return c.total === 0;
  return false;
}

/** Did the job run on every expected day? (The "Ran all week" wording.) */
export function ranAllWeek(c: { ran: number; of: number }): boolean {
  return c.of > 0 && c.ran >= c.of;
}

/** The always-visible summary. */
export const WEEK_SUMMARY_AREAS: readonly WeekArea[] = [
  {
    id: "people",
    labelKey: "admin.hub.week.area.people",
    automatic: false,
    rows: [{ id: "people", labelKey: "admin.hub.week.row.people", cell: (s) => count(s.people.total) }],
  },
  {
    id: "shift",
    labelKey: "admin.hub.week.area.shift",
    automatic: false,
    rows: [
      { id: "checklists", labelKey: "admin.hub.week.row.checklists", cell: (s) => of(s.checklistsTotal) },
      { id: "lines", labelKey: "admin.hub.week.row.lines", cell: (s) => count(s.linesTicked) },
      { id: "pm_reports", labelKey: "admin.hub.week.row.pm_reports", cell: (s) => count(s.pmReports) },
      { id: "cash_reports", labelKey: "admin.hub.week.row.cash_reports", cell: (s) => count(s.cashReports) },
    ],
  },
  {
    id: "inventory",
    labelKey: "admin.hub.week.area.inventory",
    automatic: false,
    rows: [
      { id: "orders", labelKey: "admin.hub.week.row.orders", cell: (s) => count(s.ordersPlaced) },
      { id: "deliveries", labelKey: "admin.hub.week.row.deliveries", cell: (s) => count(s.deliveriesReceived) },
      { id: "counts", labelKey: "admin.hub.week.row.counts", cell: (s) => count(s.countsRecorded) },
    ],
  },
  {
    id: "catering",
    labelKey: "admin.hub.week.area.catering",
    automatic: false,
    rows: [
      { id: "leads", labelKey: "admin.hub.week.row.leads", cell: (s) => count(s.leadsByPeople) },
      { id: "quotes", labelKey: "admin.hub.week.row.quotes", cell: (s) => count(s.quotesByPeople) },
    ],
  },
  {
    id: "automatic",
    labelKey: "admin.hub.week.area.automatic",
    automatic: true,
    rows: [
      { id: "arrived", labelKey: "admin.hub.week.row.arrived", cell: (s) => count(s.arrived.total) },
      {
        id: "toast",
        labelKey: "admin.hub.week.row.toast",
        cell: (s) => ({ kind: "days", ran: s.jobs.toastDaysRan, of: s.jobs.toastDaysExpected, failed: s.jobs.toastPullsFailed }),
      },
      { id: "ezcater_ok", labelKey: "admin.hub.week.row.ezcater_ok", cell: (s) => count(s.jobs.ezcaterSynced) },
      { id: "ezcater_errors", labelKey: "admin.hub.week.row.ezcater_errors", cell: (s) => count(s.jobs.ezcaterSyncErrors, true) },
      { id: "depletion", labelKey: "admin.hub.week.row.depletion", cell: (s) => count(s.jobs.depletionDays) },
    ],
  },
];

/** The default-collapsed breakdown (D3). */
export const WEEK_DETAIL_AREAS: readonly WeekArea[] = [
  {
    id: "people_by_role",
    labelKey: "admin.hub.week.area.people_by_role",
    automatic: false,
    rows: [
      { id: "crew", labelKey: "admin.hub.week.row.crew", cell: (s) => count(s.people.crew) },
      { id: "leads_band", labelKey: "admin.hub.week.row.leads_band", cell: (s) => count(s.people.leads) },
      { id: "managers", labelKey: "admin.hub.week.row.managers", cell: (s) => count(s.people.managers) },
    ],
  },
  {
    id: "checklists_by_type",
    labelKey: "admin.hub.week.area.checklists_by_type",
    automatic: false,
    rows: [
      { id: "opening", labelKey: "admin.hub.week.row.opening", cell: (s) => of(s.checklists.opening) },
      { id: "am_prep", labelKey: "admin.hub.week.row.am_prep", cell: (s) => of(s.checklists.am_prep) },
      { id: "mid_day", labelKey: "admin.hub.week.row.mid_day", cell: (s) => of(s.checklists.mid_day) },
      { id: "closing", labelKey: "admin.hub.week.row.closing", cell: (s) => of(s.checklists.closing) },
      { id: "system_closed", labelKey: "admin.hub.week.row.system_closed", cell: (s) => count(s.checklistsTotal.systemClosed) },
    ],
  },
  {
    id: "arrived_by_source",
    labelKey: "admin.hub.week.area.arrived_by_source",
    automatic: true,
    rows: [
      { id: "arrived_ezcater", labelKey: "admin.hub.week.row.arrived_ezcater", cell: (s) => count(s.arrived.ezcater) },
      { id: "arrived_toast", labelKey: "admin.hub.week.row.arrived_toast", cell: (s) => count(s.arrived.toastCatering) },
      { id: "arrived_other", labelKey: "admin.hub.week.row.arrived_other", cell: (s) => count(s.arrived.other) },
    ],
  },
];

/**
 * Did PEOPLE do anything this week in any column? When not, the hub collapses the card
 * (Disclosure Doctrine D3, the old card's quiet-week behaviour) — the automatic jobs alone
 * are not a reason to take the space. A failed job is an alert and keeps it open (D2).
 */
export function weekHasPeopleActivity(card: WeekCard): boolean {
  if (card.overallPeople > 0) return true;
  return card.shops.some((s) =>
    WEEK_SUMMARY_AREAS.filter((a) => !a.automatic).some((a) => a.rows.some((r) => !cellIsZero(r.cell(s)))),
  );
}

/** Any automatic job failed in any column → an alert that must not hide behind a collapse. */
export function weekHasJobAlert(card: WeekCard): boolean {
  return card.shops.some((s) => s.jobs.toastPullsFailed > 0 || s.jobs.ezcaterSyncErrors > 0);
}
