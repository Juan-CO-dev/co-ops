/**
 * THE PEOPLE FACTS — the row types every people number is computed from. Pure (types + guards).
 *
 * Scheduling Phase 1, Task 11. `loadPeopleFacts` (lib/people/facts.ts) is the ONE loader that reads
 * them, and the pure rules in lib/people/performance-shared.ts compute team scoring, person detail,
 * My Performance and the public profile from them. Each family carries the columns its legacy
 * query read (the queries moved verbatim out of lib/team-metrics.ts and lib/profiles.ts).
 *
 * A pure function asks for a family through `factsOf`, which THROWS `fact_family_not_loaded` when
 * the loader was not asked for it: a missing load fails a test loudly instead of computing a silent
 * zero.
 *
 * Later families (position intervals, prep batches, PM v2 grades, skill adjustments and ratings,
 * linked 7shifts punches) join this union in the tasks that first load them.
 */

/** Whose acts are loaded: a shop's whole roster, or one person (the queries differ, as before). */
export type FactSubject = { kind: "team"; memberIds: readonly string[] } | { kind: "person"; personId: string };

export type FactFamily =
  /** The shop's checklist instances, every date (an event in the window may name an older one). */
  | "instances"
  /** Live checklist completions in the bounds, at the shop's instances (chunks of 50 ids). */
  | "completions"
  /** Person only: instances this person confirmed in the bounds. */
  | "confirmations"
  /** Live cash reports signed in the bounds at the shop. */
  | "cash"
  /** Live PM v1 day reports submitted in the bounds at the shop. */
  | "pmReports"
  /** The live evals of those reports (their note / area-to-improve make a "notes" act). */
  | "pmNotes"
  /** The curated oversight audit rows of the subject in the bounds. */
  | "oversight"
  /** Person only: the person's live PM v1 grades on the shop's finalized reports dated in the window. */
  | "pmGrades"
  /** Person only: the shop's finalized reports dated in the window that named the person MVP. */
  | "mvps";

export const LEGACY_TEAM_FAMILIES: readonly FactFamily[] = ["instances", "completions", "cash", "pmReports", "pmNotes", "oversight"];
export const LEGACY_PERSON_FAMILIES: readonly FactFamily[] = [
  "instances", "completions", "confirmations", "cash", "pmReports", "pmNotes", "oversight", "pmGrades", "mvps",
];

/** Timestamp bounds [start, end) and the ET dates [from, to] they cover. */
export interface FactWindow {
  bounds: { start: string; end: string };
  dates: { from: string; to: string };
}

export interface InstanceFact { id: string; confirmed_by?: string | null; confirmed_at?: string | null }
export interface CompletionFact {
  instance_id: string;
  template_item_id: string;
  /** Team loads only; a person load is already filtered to the person. */
  completed_by?: string | null;
  completed_at: string;
  notes: string | null;
}
export interface ConfirmationFact { date: string; confirmed_at: string }
export interface CashFact { signed_by?: string | null; signed_at: string | null; over_short_note: string | null; report_date?: string }
export interface PmReportFact { id: string; submitted_by?: string | null; submitted_at: string | null; report_date?: string }
export interface PmNoteFact { pm_report_id: string; area_to_improve: string | null; note: string | null }

/** The audit_log columns the oversight location bind reads. */
export interface OversightAuditRow {
  resource_table: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
}
export interface OversightFact extends OversightAuditRow { actor_id?: string | null; occurred_at: string }

export interface PmGradeFact {
  pm_report_id: string;
  arrived_ready: string;
  attitude: string;
  production: string;
  team_player: string;
  area_to_improve: string | null;
}
/** A finalized PM report at the shop, by its business date (grades and MVPs are dated by it). */
export interface DatedReportFact { id: string; report_date: string }

export interface PeopleFacts {
  locationId: string;
  subject: FactSubject;
  /** What was loaded: a pure rule may compute only inside it. */
  window: FactWindow;
  instances: InstanceFact[];
  completions: CompletionFact[];
  confirmations: ConfirmationFact[];
  cash: CashFact[];
  pmReports: PmReportFact[];
  pmNotes: PmNoteFact[];
  oversight: OversightFact[];
  /** pmGrades: the finalized reports in the window, then the person's grades on them. */
  pmGradedReports: DatedReportFact[];
  pmGrades: PmGradeFact[];
  mvps: DatedReportFact[];
  loaded: ReadonlySet<FactFamily>;
}

/** An empty fact set over a window (a loader fills what it is asked for). */
export function emptyPeopleFacts(locationId: string, subject: FactSubject, window: FactWindow): PeopleFacts {
  return {
    locationId, subject, window,
    instances: [], completions: [], confirmations: [], cash: [], pmReports: [], pmNotes: [], oversight: [],
    pmGradedReports: [], pmGrades: [], mvps: [], loaded: new Set(),
  };
}

export class FactFamilyNotLoadedError extends Error {
  constructor(public family: FactFamily) { super("fact_family_not_loaded"); }
}

/** Throws `fact_family_not_loaded` unless every named family was loaded. */
export function requireFamilies(facts: PeopleFacts, ...families: FactFamily[]): void {
  for (const f of families) if (!facts.loaded.has(f)) throw new FactFamilyNotLoadedError(f);
}

/** The smallest window covering both (a compare loads ONCE over the union, then computes twice). */
export function unionWindow(a: FactWindow, b: FactWindow): FactWindow {
  const min = (x: string, y: string) => (Date.parse(x) <= Date.parse(y) ? x : y);
  const max = (x: string, y: string) => (Date.parse(x) >= Date.parse(y) ? x : y);
  return {
    bounds: { start: min(a.bounds.start, b.bounds.start), end: max(a.bounds.end, b.bounds.end) },
    dates: { from: a.dates.from <= b.dates.from ? a.dates.from : b.dates.from, to: a.dates.to >= b.dates.to ? a.dates.to : b.dates.to },
  };
}

/** True when `iso` lies in [start, end), compared as instants (never as strings). */
export function inBounds(iso: string, bounds: { start: string; end: string }): boolean {
  const t = Date.parse(iso);
  return t >= Date.parse(bounds.start) && t < Date.parse(bounds.end);
}
