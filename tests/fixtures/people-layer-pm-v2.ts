/**
 * Scheduling Phase 1, Task 23 — PM v2 rows laid OVER the people-layer equivalence fixture.
 *
 * The golden fixture is never edited (it froze the legacy numbers). This overlay adds what a shop that
 * runs PM v2 would hold, in the tables the v2 path reads, without touching a row a legacy loader reads in
 * a way that could move a legacy number:
 *   · two SUBMITTED days at LOC_A are stamped `format = 'v2'` (a legacy loader never reads `format`);
 *   · an OPEN v2 day at LOC_A (no submitter, so no legacy loader counts it);
 *   · LOC_B's `pm-b-fixed-1` (submitted) is stamped v2, beside the golden's own copy-1 / grade-1;
 *   · per v2 day, copies by the GM and the KH (sealed), with grades for the employee — a "Didn't see"
 *     (NULL) and a superseded grade among them — a grade on the shift lead, and notes (one superseded);
 *   · the open day's copy, with grades and a note that must count nowhere;
 *   · `people_shop_settings` exactly as the caller asks (absent, off, or on for one shop).
 */
import { LOC_A, LOC_B, U, type Tables } from "./people-layer-fixture";

type Row = Record<string, unknown>;

export const POS_WALKINS = "pos-a-walkins";
export const POS_EXPO = "pos-a-expo";

/** What the overlay put where — the test derives every expected delta from it. */
export interface PmV2Overlay {
  tables: Tables;
  /** The two submitted v2 days at LOC_A: id, business date, submitted_at. */
  daysA: Array<{ id: string; date: string; submittedAt: string }>;
  /** Live, non-null grades on SUBMITTED v2 days at LOC_A, by subject. */
  gradesA: Record<string, Array<{ date: string; grade: "great" | "good" | "needs_work" }>>;
  /** Live notes on SUBMITTED v2 days at LOC_A, by copy author. */
  notesA: Record<string, Array<{ submittedAt: string }>>;
}

const clone = (t: Tables): Tables => Object.fromEntries(Object.entries(t).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));

export function withPmV2Rows(base: Tables, settings: ReadonlyArray<{ location_id: string; pm_v2: boolean }> | null): PmV2Overlay {
  const t = clone(base);
  const reports = t.pm_reports!;
  const picked = reports
    .filter((r) => r.location_id === LOC_A && r.status === "submitted" && r.superseded_at === null && r.submitted_at
      && (r.report_date as string) >= "2026-10-06" && (r.report_date as string) <= "2026-10-13")
    .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)))
    .slice(0, 2);
  if (picked.length !== 2) throw new Error("overlay: expected two submitted LOC_A days in 2026-10-06..13");
  for (const r of picked) r.format = "v2";
  reports.push({ id: "pm-a-v2-open", location_id: LOC_A, report_date: "2026-10-14", status: "open", submitted_by: null, submitted_at: null, mvp_user_id: null, superseded_at: null, format: "v2" });
  reports.find((r) => r.id === "pm-b-fixed-1")!.format = "v2";

  const copies: Row[] = t.pm_report_copies!;
  const grades: Row[] = t.pm_copy_grades!;
  const notes: Row[] = (t.pm_copy_notes ??= []);
  const gradesA: PmV2Overlay["gradesA"] = {};
  const notesA: PmV2Overlay["notesA"] = {};
  const grade = (id: string, copy: string, loc: string, subject: string, position: string | null, criterion: string, g: string | null, superseded = false) =>
    grades.push({ id, copy_id: copy, location_id: loc, subject_id: subject, position_id: position, criterion_id: criterion, grade: g, superseded_at: superseded ? "2026-10-13T23:00:00Z" : null });
  const note = (id: string, copy: string, loc: string, subject: string, position: string | null, text: string, superseded = false) =>
    notes.push({ id, copy_id: copy, location_id: loc, subject_id: subject, position_id: position, note: text, superseded_at: superseded ? "2026-10-13T23:00:00Z" : null });

  for (const [i, day] of picked.entries()) {
    const date = day.report_date as string;
    const submittedAt = day.submitted_at as string;
    const gmCopy = `copy-a-gm-${i}`, khCopy = `copy-a-kh-${i}`;
    for (const [id, author] of [[gmCopy, U.gm], [khCopy, U.kh]] as const) {
      copies.push({ id, pm_report_id: day.id, location_id: LOC_A, author_id: author, status: "sealed",
        observed_from: `${date}T14:00:00Z`, observed_to: `${date}T22:00:00Z`, sealed_at: submittedAt });
    }
    // The employee, graded by both managers: great/good + a "Didn't see" from the GM, needs work/great from the KH.
    grade(`g-a-${i}-1`, gmCopy, LOC_A, U.emp, POS_WALKINS, "crit-a-1", "great");
    grade(`g-a-${i}-2`, gmCopy, LOC_A, U.emp, POS_WALKINS, "crit-a-2", "good");
    grade(`g-a-${i}-3`, gmCopy, LOC_A, U.emp, POS_WALKINS, "crit-a-3", null);
    grade(`g-a-${i}-4`, khCopy, LOC_A, U.emp, POS_WALKINS, "crit-a-1", "needs_work");
    grade(`g-a-${i}-5`, khCopy, LOC_A, U.emp, POS_WALKINS, "crit-a-2", "great");
    grade(`g-a-${i}-6`, khCopy, LOC_A, U.emp, POS_WALKINS, "crit-a-3", "great", true); // superseded: never counts
    grade(`g-a-${i}-7`, gmCopy, LOC_A, U.slBoth, POS_EXPO, "crit-a-1", "good");
    (gradesA[U.emp] ??= []).push({ date, grade: "great" }, { date, grade: "good" }, { date, grade: "needs_work" }, { date, grade: "great" });
    (gradesA[U.slBoth] ??= []).push({ date, grade: "good" });
    note(`n-a-${i}-1`, gmCopy, LOC_A, U.emp, POS_WALKINS, "Greets every guest by name");
    (notesA[U.gm] ??= []).push({ submittedAt });
    if (i === 0) {
      note(`n-a-${i}-2`, khCopy, LOC_A, U.slBoth, POS_EXPO, "Kept tickets moving at the rush");
      note(`n-a-${i}-3`, khCopy, LOC_A, U.slBoth, POS_EXPO, "old wording", true); // superseded: never counts
      (notesA[U.kh] ??= []).push({ submittedAt });
    }
  }

  // The OPEN v2 day: a copy with grades and a note that count nowhere.
  copies.push({ id: "copy-a-open", pm_report_id: "pm-a-v2-open", location_id: LOC_A, author_id: U.gm, status: "open",
    observed_from: "2026-10-14T14:00:00Z", observed_to: "2026-10-14T20:00:00Z", sealed_at: null });
  grade("g-a-open-1", "copy-a-open", LOC_A, U.emp, POS_WALKINS, "crit-a-1", "great");
  grade("g-a-open-2", "copy-a-open", LOC_A, U.emp, POS_WALKINS, "crit-a-2", "needs_work");
  note("n-a-open-1", "copy-a-open", LOC_A, U.emp, POS_WALKINS, "Not submitted yet");

  // LOC_B's v2 day (the golden's copy-1 / grade-1 already sit on it): one more grade and a note.
  copies.find((c) => c.id === "copy-1")!.observed_from = "2026-10-03T14:00:00Z";
  grade("g-b-2", "copy-1", LOC_B, U.empB, "pos-b-expo", "crit-1", "needs_work");
  note("n-b-1", "copy-1", LOC_B, U.empB, "pos-b-expo", "Shop B note");

  if (settings) t.people_shop_settings = settings.map((s) => ({ location_id: s.location_id, pm_v2: s.pm_v2, prep_position_id: null }));
  return { tables: t, daysA: picked.map((d) => ({ id: d.id as string, date: d.report_date as string, submittedAt: d.submitted_at as string })), gradesA, notesA };
}
