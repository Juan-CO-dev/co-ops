/**
 * PM REPORTS v2 — the lib: copies, writes through the 0271 RPCs, submit, and the loaders. Server-only,
 * service role. Scheduling Phase 1, Task 20.
 *
 * EVERY rule is decided here FIRST, before any I/O it can precede, from lib/people/access-shared.ts and
 * lib/pm-report-v2-shared.ts; the 0271 RPCs decide the same rules again in the database:
 *   who      — KH+ with the pm_report task at the shop (today's rule), never the social media manager;
 *              the location bind (own shops; level 9+ any);
 *   lifecycle — the ONE table (PM_COPY_TRANSITIONS): writes need an OPEN copy on an open day; a done copy
 *              is read-only until its author taps Reopen; submit seals every copy;
 *   targets  — r1 P1-1: a grade names an ACTIVE position (on an active station) of the copy's shop that the
 *              subject worked that day or THIS copy added, and a criterion of that shop for that position
 *              (`gradeTargetProblem`, pinned to the RPC's codes by one shared case file).
 * Every RPC refusal maps by name to `PmReportError` with its status (PM_V2_ERROR_STATUS).
 *
 * PRIVACY. A copy is read by its author only until the closing manager submits (MoO and Owner included);
 * other managers see COUNTS only. After submit: the day's authors, GM / Op-6 of the shop, MoO+
 * (`canReadPmDayResults`). The subject sees their own averaged grades as bands from SUBMITTED days only —
 * no author, no note text (R9).
 *
 * NOTHING HERE SENDS ANYTHING. No email, no notification (pinned by tests/pm-report-v2-no-notify.test.ts).
 * Audit rows carry ids and codes only, never note text.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit-actions";
import { etYmdMinusDays, operationalDayUtcRange } from "@/lib/operational-day";
import { assertPmTaskAccess, getOrCreatePmReport, PmReportError } from "@/lib/pm-report";
import {
  canReadPmDayResults, canSubmitPmDay, pmCopyActRefusal, type PeopleActor, type PmCopyAct, type PmCopyStatus, type PmDayRef,
  type PmDayStatus,
} from "@/lib/people/access-shared";
import { isMissingTable } from "@/lib/people/facts";
import { closeOpenIntervals, positionTimeline, type PositionInterval } from "@/lib/people/positions-shared";
import { positionUsable } from "@/lib/people/skill-matrix-shared";
import {
  PM_GRADES, PM_V2_ERROR_STATUS, addedPositionProblem, averageGrades, copyFormState, criteriaForPosition, gradeBand,
  gradeTargetProblem, observationMinutes, pmRefusalCode, rosterForCopy, weightKey, writeInThemes, type AddedPosition,
  type AttributedNote, type AveragedCell, type PmBand, type PmGrade, type PmV2ErrorCode, type Theme,
} from "@/lib/pm-report-v2-shared";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { StationEvent } from "@/lib/assignments-shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_CHUNK = 50;
export const PM_V2_NOTE_MAX = 500;
export const PM_V2_REASON_MAX = 200;
export const PM_V2_THEME_DAYS = 30;

function refuse(code: PmV2ErrorCode): never {
  throw new PmReportError(PM_V2_ERROR_STATUS[code], code);
}
function requireUuid(v: unknown): asserts v is string {
  if (typeof v !== "string" || !UUID.test(v)) refuse("invalid_payload");
}
function chunk<T>(xs: readonly T[], n = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
/** The 0271 refusals by name; anything else is `write_failed`. Before 0271 is applied: `pm_v2_unavailable`. */
export function pmRpcFailure(error: { code?: string; message: string }): never {
  if (/does not exist|could not find the function/i.test(error.message) || error.code === "42883" || error.code === "PGRST202") refuse("pm_v2_unavailable");
  const code = Object.keys(PM_V2_ERROR_STATUS).find((c) => c === error.message) as PmV2ErrorCode | undefined;
  refuse(code ?? "write_failed");
}

// ─── who ─────────────────────────────────────────────────────────────────────

function bound(actor: PeopleActor, locationId: string): boolean {
  return actor.level >= 9 || actor.locations.includes(locationId);
}
/** KH+, not the SMM, bound to the shop: decided before any I/O. Then the pm_report task (one read). */
async function requireManagerAt(service: SupabaseClient, actor: PeopleActor, locationId: string): Promise<void> {
  requireUuid(locationId);
  if (!canSubmitPmDay(actor) || !bound(actor, locationId)) refuse("forbidden");
  await assertPmTaskAccess(service, actor, locationId);
}

// ─── reads shared by the loaders and the writers ─────────────────────────────

interface DayRow { id: string; location_id: string; report_date: string; status: PmDayStatus; format?: string | null; submitted_by: string | null; submitted_at: string | null; mvp_user_id: string | null }
interface CopyRow { id: string; pm_report_id: string; location_id: string; author_id: string; status: PmCopyStatus; observed_from: string | null; observed_to: string | null; created_at: string; sealed_at: string | null }
interface PositionRow { id: string; station_id: string; location_id: string; name: string; name_es: string | null; sort: number; active: boolean }
interface StationRow { id: string; active: boolean; sort: number }
interface CriterionRow { id: string; location_id: string; position_id: string | null; label: string; label_es: string | null; sort: number; active: boolean }
interface GradeRow { id: string; copy_id: string; location_id: string; subject_id: string; position_id: string | null; criterion_id: string; grade: PmGrade | null }
interface NoteRow { id: string; copy_id: string; subject_id: string; position_id: string | null; note: string }
interface AddedRow { id: string; copy_id: string; subject_id: string; position_id: string; reason: string }

async function loadDay(service: SupabaseClient, locationId: string, date: string): Promise<DayRow | null> {
  const { data, error } = await service.from("pm_reports").select("*").eq("location_id", locationId).eq("report_date", date)
    .is("superseded_at", null).maybeSingle();
  if (error) throw new Error(`pm v2 day: ${error.message}`);
  return (data as DayRow | null) ?? null;
}
async function loadDayById(service: SupabaseClient, id: string): Promise<DayRow | null> {
  const { data, error } = await service.from("pm_reports").select("*").eq("id", id).is("superseded_at", null).maybeSingle();
  if (error) throw new Error(`pm v2 day: ${error.message}`);
  return (data as DayRow | null) ?? null;
}
async function loadCopies(service: SupabaseClient, reportId: string): Promise<CopyRow[]> {
  return selectAllRows<CopyRow>((from, to) => service.from("pm_report_copies")
    .select("id, pm_report_id, location_id, author_id, status, observed_from, observed_to, created_at, sealed_at")
    .eq("pm_report_id", reportId).order("created_at", { ascending: true }).range(from, to));
}
async function loadShopPositions(service: SupabaseClient, locationId: string): Promise<{ positions: PositionRow[]; stations: StationRow[] }> {
  const positions = await selectAllRows<PositionRow>((from, to) => service.from("station_positions")
    .select("id, station_id, location_id, name, name_es, sort, active").eq("location_id", locationId).order("id", { ascending: true }).range(from, to));
  const stations = await selectAllRows<StationRow>((from, to) => service.from("stations")
    .select("id, active, sort").eq("location_id", locationId).order("id", { ascending: true }).range(from, to));
  return { positions, stations };
}
async function loadCriteria(service: SupabaseClient, locationId: string, activeOnly: boolean): Promise<CriterionRow[]> {
  return selectAllRows<CriterionRow>((from, to) => {
    let q = service.from("pm_criteria").select("id, location_id, position_id, label, label_es, sort, active").eq("location_id", locationId);
    if (activeOnly) q = q.eq("active", true);
    return q.order("id", { ascending: true }).range(from, to);
  });
}
async function loadLive<T>(service: SupabaseClient, table: "pm_copy_grades" | "pm_copy_notes" | "pm_copy_positions", cols: string, copyIds: readonly string[], subjectIds?: readonly string[]): Promise<T[]> {
  const out: T[] = [];
  for (const ids of chunk([...new Set(copyIds)])) {
    out.push(...await selectAllRows<T>((from, to) => {
      let q = service.from(table).select(cols).in("copy_id", ids).is("superseded_at", null);
      if (subjectIds) q = q.in("subject_id", [...subjectIds]);
      return q.order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
    }));
  }
  return out;
}
/** The day's position intervals at the shop (station_events), open ones closed at min(the day's end, now). */
async function loadDayIntervals(service: SupabaseClient, locationId: string, date: string, userIds?: readonly string[], now = new Date()): Promise<PositionInterval[]> {
  type Row = { id: string; sequence: string | number; location_id: string; business_date: string; user_id: string; station_id: string | null;
    position_id: string | null; kind: StationEvent["kind"]; at: string; source: StationEvent["source"]; effective_at: string | null; reason_code: string | null };
  const cols = "id, sequence, location_id, business_date, user_id, station_id, position_id, kind, at, source, effective_at, reason_code";
  const rows: Row[] = [];
  const groups = userIds ? chunk([...new Set(userIds)]) : [null];
  for (const ids of groups) {
    if (ids && ids.length === 0) continue;
    rows.push(...await selectAllRows<Row>((from, to) => {
      let q = service.from("station_events").select(cols).eq("location_id", locationId).eq("business_date", date);
      if (ids) q = q.in("user_id", ids);
      return q.order("sequence", { ascending: true }).range(from, to);
    }));
  }
  const events: StationEvent[] = rows.map((r) => ({
    id: r.id, sequence: String(r.sequence), locationId: r.location_id, businessDate: r.business_date, userId: r.user_id,
    stationId: r.station_id, positionId: r.position_id, kind: r.kind, actorId: null, actorName: null, at: r.at, source: r.source,
    effectiveAt: r.effective_at, ...(r.kind === "release" && r.reason_code === "station_closed" ? { releaseReason: "station_closed" as const } : {}),
  }));
  const dayEnd = Date.parse(operationalDayUtcRange(date).endExclusiveIso);
  return closeOpenIntervals(positionTimeline(events), new Date(Math.min(dayEnd, now.getTime())).toISOString());
}
async function loadNames(service: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunk([...new Set(ids)])) {
    if (!part.length) continue;
    const { data, error } = await service.from("users").select("id, name").in("id", part);
    if (error) throw new Error(`pm v2 names: ${error.message}`);
    for (const u of (data ?? []) as Array<{ id: string; name: string }>) out.set(u.id, u.name);
  }
  return out;
}

/** The day row's state for the page's choice (format and status), or null when there is none. */
export async function pmDayState(service: SupabaseClient, locationId: string, date: string): Promise<{ id: string; status: PmDayStatus; format: "v1" | "v2" } | null> {
  const day = await loadDay(service, locationId, date);
  return day ? { id: day.id, status: day.status, format: day.format === "v2" ? "v2" : "v1" } : null;
}

function dayRef(day: DayRow, copies: readonly CopyRow[]): PmDayRef {
  return { locationId: day.location_id, status: day.status, authorIds: copies.map((c) => c.author_id) };
}

// ─── the actor's copy ────────────────────────────────────────────────────────

/** Open (or return) the actor's copy of today's v2 day. A v1 day answers `format_mismatch`. Audited when created. */
export async function openMyCopy(service: SupabaseClient, args: { actor: PeopleActor; locationId: string; date: string }): Promise<{ copyId: string; reportId: string }> {
  await requireManagerAt(service, args.actor, args.locationId);
  const day = await getOrCreatePmReport(service, { locationId: args.locationId, date: args.date, actor: args.actor });
  if (day.format !== "v2") refuse("format_mismatch");
  const { data, error } = await service.rpc("open_pm_copy", { p_actor: args.actor.userId, p_report: day.id });
  if (error) pmRpcFailure(error);
  const r = data as { id: string; created: boolean };
  if (r.created) await auditCopy(args.actor, "pm_report.copy_open", r.id, { pm_report_id: day.id, location_id: args.locationId });
  return { copyId: r.id, reportId: day.id };
}

export interface PmCopyCriterionView { id: string; label: string; labelEs: string | null }
export interface PmCopyPositionView {
  positionId: string | null; name: string | null; nameEs: string | null; minutes: number; added: { reason: string } | null;
  criteria: PmCopyCriterionView[];
  /** Answered criteria only: a grade, or null = "Didn't see". An unanswered criterion is absent. */
  answers: Array<{ criterionId: string; grade: PmGrade | null }>;
  note: string | null;
}
export interface PmCopyView {
  reportId: string; date: string; locationId: string; dayStatus: PmDayStatus; mvpUserId: string | null;
  copy: { id: string; status: PmCopyStatus; observedFrom: string | null; observedTo: string | null };
  formState: "editable" | "done_readonly" | "sealed";
  /** Other managers' copies: COUNTS ONLY (blind until submit). */
  others: { started: number; done: number };
  people: Array<{ subjectId: string; name: string; rated: boolean; positions: PmCopyPositionView[] }>;
  /** Usable positions of this shop for "Worked somewhere else?" (active, on an active station). */
  availablePositions: Array<{ positionId: string; name: string; nameEs: string | null }>;
  summary: { people: number; rated: number };
}

/**
 * The actor's OWN copy and nothing of anyone else's but counts: the roster (`rosterForCopy` over the presence
 * roster, the day's position intervals and THIS copy's added positions), the criteria per position, and the
 * actor's own grades and notes.
 */
export async function loadMyCopy(service: SupabaseClient, args: {
  actor: PeopleActor; locationId: string; date: string; presenceRoster: ReadonlyArray<{ id: string; name: string }>; now?: Date;
}): Promise<PmCopyView | null> {
  await requireManagerAt(service, args.actor, args.locationId);
  const day = await loadDay(service, args.locationId, args.date);
  if (!day || day.format !== "v2") return null;
  const copies = await loadCopies(service, day.id);
  const mine = copies.find((c) => c.author_id === args.actor.userId);
  if (!mine) return null;
  const others = copies.filter((c) => c.author_id !== args.actor.userId);
  const subjectIds = args.presenceRoster.map((p) => p.id);
  const [intervals, { positions, stations }, criteria, added, grades, notes] = await Promise.all([
    loadDayIntervals(service, args.locationId, args.date, subjectIds, args.now),
    loadShopPositions(service, args.locationId),
    loadCriteria(service, args.locationId, true),
    loadLive<AddedRow>(service, "pm_copy_positions", "id, copy_id, subject_id, position_id, reason", [mine.id]),
    loadLive<GradeRow>(service, "pm_copy_grades", "id, copy_id, location_id, subject_id, position_id, criterion_id, grade", [mine.id]),
    loadLive<NoteRow>(service, "pm_copy_notes", "id, copy_id, subject_id, position_id, note", [mine.id]),
  ]);
  const posById = new Map(positions.map((p) => [p.id, p] as const));
  const addedPositions: AddedPosition[] = added.map((a) => ({ subjectId: a.subject_id, positionId: a.position_id, byAuthorId: mine.author_id, reason: a.reason }));
  const crit = criteria.map((c) => ({ id: c.id, positionId: c.position_id, label: c.label, labelEs: c.label_es, sort: c.sort, active: c.active }));
  const roster = rosterForCopy(args.presenceRoster, intervals, addedPositions);
  const people = roster.map((person) => {
    const positionsView: PmCopyPositionView[] = person.positions.map((p) => {
      const row = p.positionId ? posById.get(p.positionId) : undefined;
      const answers = grades.filter((g) => g.subject_id === person.subjectId && g.position_id === p.positionId)
        .map((g) => ({ criterionId: g.criterion_id, grade: g.grade }));
      const note = notes.find((n) => n.subject_id === person.subjectId && n.position_id === p.positionId)?.note ?? null;
      return {
        positionId: p.positionId, name: row?.name ?? null, nameEs: row?.name_es ?? null, minutes: p.minutes,
        added: p.added ? { reason: p.added.reason } : null,
        criteria: criteriaForPosition(crit, p.positionId).map((c) => ({ id: c.id, label: c.label, labelEs: c.labelEs })),
        answers, note,
      };
    });
    return { subjectId: person.subjectId, name: person.name, rated: positionsView.some((p) => p.answers.length > 0), positions: positionsView };
  });
  const ref = dayRef(day, copies);
  return {
    reportId: day.id, date: day.report_date, locationId: day.location_id, dayStatus: day.status, mvpUserId: day.mvp_user_id,
    copy: { id: mine.id, status: mine.status, observedFrom: mine.observed_from, observedTo: mine.observed_to },
    formState: copyFormState({ authorId: mine.author_id, locationId: mine.location_id, status: mine.status }, ref),
    others: { started: others.length, done: others.filter((c) => c.status === "done").length },
    people,
    availablePositions: positions.filter((p) => positionUsable(p, stations))
      .sort((a, b) => (stations.find((s) => s.id === a.station_id)?.sort ?? 0) - (stations.find((s) => s.id === b.station_id)?.sort ?? 0) || a.sort - b.sort || a.name.localeCompare(b.name))
      .map((p) => ({ positionId: p.id, name: p.name, nameEs: p.name_es })),
    summary: { people: people.length, rated: people.filter((p) => p.rated).length },
  };
}

// ─── the writers ─────────────────────────────────────────────────────────────

async function auditCopy(actor: PeopleActor, action: AuditAction, resourceId: string | null, metadata: Record<string, unknown>): Promise<void> {
  await audit({ actorId: actor.userId, actorRole: actor.role, action, resourceTable: "pm_report_copies", resourceId, metadata, ipAddress: null, userAgent: null });
}

/** The copy + its day, judged by the ONE lifecycle for `act` before any write (the lib layer of r1 P2-9). */
async function copyForAct(service: SupabaseClient, actor: PeopleActor, locationId: string, copyId: unknown, act: PmCopyAct): Promise<{ copy: CopyRow; day: DayRow }> {
  await requireManagerAt(service, actor, locationId);
  requireUuid(copyId);
  const { data, error } = await service.from("pm_report_copies")
    .select("id, pm_report_id, location_id, author_id, status, observed_from, observed_to, created_at, sealed_at").eq("id", copyId).maybeSingle();
  if (error) { if (isMissingTable(error)) refuse("pm_v2_unavailable"); throw new Error(`pm v2 copy: ${error.message}`); }
  const copy = data as CopyRow | null;
  if (!copy || copy.location_id !== locationId) refuse("not_found");
  const day = await loadDayById(service, copy.pm_report_id);
  if (!day) refuse("not_found");
  if (day.format !== "v2") refuse("format_mismatch");
  const refusal = pmCopyActRefusal(act, actor, { authorId: copy.author_id, locationId: copy.location_id, status: copy.status }, { locationId: day.location_id, status: day.status, authorIds: [copy.author_id] });
  if (refusal) refuse(pmRefusalCode(refusal));
  return { copy, day };
}

/** The lib twin of the RPC's checks 5–8 (r1 P1-1): the position's row (with its station), worked, added, the criterion. */
async function targetProblem(service: SupabaseClient, copy: CopyRow, day: DayRow, subjectId: string, positionId: string | null, criterionId?: string): Promise<void> {
  let position: { id: string; locationId: string; active: boolean } | null | undefined = null;
  const worked = new Set<string>();
  const addedHere = new Set<string>();
  if (positionId !== null) {
    const { data: p, error: pe } = await service.from("station_positions").select("id, station_id, location_id, active").eq("id", positionId).maybeSingle();
    if (pe) throw new Error(`pm v2 position: ${pe.message}`);
    const row = p as { id: string; station_id: string; location_id: string; active: boolean } | null;
    if (row) {
      const { data: s, error: se } = await service.from("stations").select("id, active").eq("id", row.station_id).maybeSingle();
      if (se) throw new Error(`pm v2 station: ${se.message}`);
      position = { id: row.id, locationId: row.location_id, active: positionUsable(row, s ? [s as { id: string; active: boolean }] : []) };
    } else position = undefined;
    const { data: ev, error: ee } = await service.from("station_events").select("id").eq("location_id", copy.location_id)
      .eq("business_date", day.report_date).eq("user_id", subjectId).eq("position_id", positionId).limit(1);
    if (ee) throw new Error(`pm v2 worked: ${ee.message}`);
    if ((ev ?? []).length > 0) worked.add(positionId);
    const { data: ad, error: ae } = await service.from("pm_copy_positions").select("id").eq("copy_id", copy.id).eq("subject_id", subjectId)
      .eq("position_id", positionId).is("superseded_at", null).limit(1);
    if (ae) throw new Error(`pm v2 added: ${ae.message}`);
    if ((ad ?? []).length > 0) addedHere.add(positionId);
  }
  let criterion: { locationId: string; positionId: string | null; active: boolean } | null | undefined;
  if (criterionId !== undefined) {
    const { data: c, error: ce } = await service.from("pm_criteria").select("id, location_id, position_id, active").eq("id", criterionId).maybeSingle();
    if (ce) throw new Error(`pm v2 criterion: ${ce.message}`);
    const row = c as { location_id: string; position_id: string | null; active: boolean } | null;
    criterion = row ? { locationId: row.location_id, positionId: row.position_id, active: row.active } : null;
  }
  const problem = gradeTargetProblem({ position, positionId, copyLocationId: copy.location_id, workedPositionIds: worked, addedByThisCopy: addedHere, ...(criterionId !== undefined ? { criterion } : {}) });
  if (problem) refuse(problem);
}

export interface PmCopyWriteArgs { actor: PeopleActor; locationId: string; copyId: unknown }

/** One grade (or null = "Didn't see"). Audited `pm_report.copy_grade` (ids and the grade; never a note). */
export async function saveGrade(service: SupabaseClient, args: PmCopyWriteArgs & { subjectId: unknown; positionId: unknown; criterionId: unknown; grade: unknown }): Promise<{ id: string }> {
  requireUuid(args.subjectId); requireUuid(args.criterionId);
  if (args.positionId !== null) requireUuid(args.positionId);
  if (args.grade !== null && !(PM_GRADES as readonly unknown[]).includes(args.grade)) refuse("invalid_payload");
  const { copy, day } = await copyForAct(service, args.actor, args.locationId, args.copyId, "write");
  const positionId = args.positionId as string | null;
  await targetProblem(service, copy, day, args.subjectId, positionId, args.criterionId);
  const { data, error } = await service.rpc("save_pm_copy_grade", {
    p_actor: args.actor.userId, p_copy: copy.id, p_subject: args.subjectId, p_position: positionId, p_criterion: args.criterionId, p_grade: args.grade,
  });
  if (error) pmRpcFailure(error);
  const id = (data as { id: string }).id;
  await auditCopy(args.actor, "pm_report.copy_grade", copy.id, { grade_id: id, subject_id: args.subjectId, position_id: positionId, criterion_id: args.criterionId, grade: args.grade });
  return { id };
}

/** The free text for a person (≤ 500; blank clears). Audited WITHOUT the text (R9). */
export async function saveNote(service: SupabaseClient, args: PmCopyWriteArgs & { subjectId: unknown; positionId: unknown; note: unknown }): Promise<{ id: string | null }> {
  requireUuid(args.subjectId);
  if (args.positionId !== null) requireUuid(args.positionId);
  if (args.note !== null && typeof args.note !== "string") refuse("invalid_payload");
  const note = typeof args.note === "string" ? args.note.trim() : "";
  if (note.length > PM_V2_NOTE_MAX) refuse("invalid_note");
  const { copy, day } = await copyForAct(service, args.actor, args.locationId, args.copyId, "write");
  const positionId = args.positionId as string | null;
  await targetProblem(service, copy, day, args.subjectId, positionId);
  const { data, error } = await service.rpc("save_pm_copy_note", { p_actor: args.actor.userId, p_copy: copy.id, p_subject: args.subjectId, p_position: positionId, p_note: note || null });
  if (error) pmRpcFailure(error);
  const id = (data as { id: string | null }).id;
  await auditCopy(args.actor, "pm_report.copy_note", copy.id, { note_id: id, subject_id: args.subjectId, position_id: positionId, cleared: id === null });
  return { id };
}

/** "Worked somewhere else?": checks 5–6 only (that is its purpose), a reason. Audited without the reason text. */
export async function addPosition(service: SupabaseClient, args: PmCopyWriteArgs & { subjectId: unknown; positionId: unknown; reason: unknown }): Promise<{ id: string }> {
  requireUuid(args.subjectId); requireUuid(args.positionId);
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (reason.length < 1 || reason.length > PM_V2_REASON_MAX) refuse("invalid_reason");
  const { copy } = await copyForAct(service, args.actor, args.locationId, args.copyId, "write");
  const { data: p, error: pe } = await service.from("station_positions").select("id, station_id, location_id, active").eq("id", args.positionId).maybeSingle();
  if (pe) throw new Error(`pm v2 position: ${pe.message}`);
  const row = p as { station_id: string; location_id: string; active: boolean } | null;
  let usable: { locationId: string; active: boolean } | null = null;
  if (row) {
    const { data: s, error: se } = await service.from("stations").select("id, active").eq("id", row.station_id).maybeSingle();
    if (se) throw new Error(`pm v2 station: ${se.message}`);
    usable = { locationId: row.location_id, active: positionUsable(row, s ? [s as { id: string; active: boolean }] : []) };
  }
  const problem = addedPositionProblem(usable, copy.location_id);
  if (problem) refuse(problem);
  const { data, error } = await service.rpc("add_pm_copy_position", { p_actor: args.actor.userId, p_copy: copy.id, p_subject: args.subjectId, p_position: args.positionId, p_reason: reason });
  if (error) pmRpcFailure(error);
  const id = (data as { id: string }).id;
  await auditCopy(args.actor, "pm_report.copy_position_add", copy.id, { added_id: id, subject_id: args.subjectId, position_id: args.positionId });
  return { id };
}

/** "My time on the floor": instants inside the business day (the RPC bounds them); `to` may stay empty. */
export async function setWindow(service: SupabaseClient, args: PmCopyWriteArgs & { from: unknown; to: unknown }): Promise<void> {
  const ok = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  if (!ok(args.from) || (args.to !== null && !ok(args.to))) refuse("invalid_window");
  if (args.to !== null && Date.parse(args.to as string) <= Date.parse(args.from as string)) refuse("invalid_window");
  const { copy } = await copyForAct(service, args.actor, args.locationId, args.copyId, "write");
  const { error } = await service.rpc("set_pm_copy_window", { p_actor: args.actor.userId, p_copy: copy.id, p_from: args.from, p_to: args.to });
  if (error) pmRpcFailure(error);
  await auditCopy(args.actor, "pm_report.copy_window", copy.id, { observed_from: args.from, observed_to: args.to });
}

/** open → done (the window must be set). */
export async function markDone(service: SupabaseClient, args: PmCopyWriteArgs): Promise<void> {
  const { copy } = await copyForAct(service, args.actor, args.locationId, args.copyId, "markDone");
  if (!copy.observed_from) refuse("window_required");
  const { error } = await service.rpc("mark_pm_copy_done", { p_actor: args.actor.userId, p_copy: copy.id });
  if (error) pmRpcFailure(error);
  await auditCopy(args.actor, "pm_report.copy_done", copy.id, { pm_report_id: copy.pm_report_id });
}

/** done → open: the author, on an open day (J16). */
export async function reopenCopy(service: SupabaseClient, args: PmCopyWriteArgs): Promise<void> {
  const { copy } = await copyForAct(service, args.actor, args.locationId, args.copyId, "reopen");
  const { error } = await service.rpc("reopen_pm_copy", { p_actor: args.actor.userId, p_copy: copy.id });
  if (error) pmRpcFailure(error);
  await auditCopy(args.actor, "pm_report.copy_reopen", copy.id, { pm_report_id: copy.pm_report_id });
}

/**
 * The closing manager submits the day: ONE guarded flip that seals every copy (submit_pm_day_v2). A losing
 * submit is `{ changed: false }` (the v1 doctrine). NO notification — v1's SHIFT_FEEDBACK is not sent on a v2
 * day. Audited `pm_report.submit_v2`.
 */
export async function submitDay(service: SupabaseClient, args: { actor: PeopleActor; locationId: string; date: string }): Promise<{ changed: boolean; sealed: number }> {
  await requireManagerAt(service, args.actor, args.locationId);
  const day = await loadDay(service, args.locationId, args.date);
  if (!day) refuse("not_found");
  if (day.format !== "v2") refuse("format_mismatch");
  const { data, error } = await service.rpc("submit_pm_day_v2", { p_actor: args.actor.userId, p_report: day.id });
  if (error) pmRpcFailure(error);
  const r = data as { changed: boolean; sealed?: number };
  if (r.changed) {
    await audit({ actorId: args.actor.userId, actorRole: args.actor.role, action: "pm_report.submit_v2", resourceTable: "pm_reports", resourceId: day.id,
      metadata: { location_id: args.locationId, sealed: r.sealed ?? 0 }, ipAddress: null, userAgent: null });
  }
  return { changed: r.changed, sealed: r.sealed ?? 0 };
}

/**
 * The shift MVP on a v2 day: the SAME guarded UPDATE as v1's setMvp (status open, checked rowcount), bound to
 * `format = 'v2'`, so the existing MVP scoring keeps reading `pm_reports.mvp_user_id`.
 */
export async function setMvpV2(service: SupabaseClient, args: { actor: PeopleActor; locationId: string; date: string; mvpUserId: string | null; mvpNote: string | null }): Promise<void> {
  await requireManagerAt(service, args.actor, args.locationId);
  if (args.mvpUserId !== null) requireUuid(args.mvpUserId);
  const day = await loadDay(service, args.locationId, args.date);
  if (!day) refuse("not_found");
  if (day.format !== "v2") refuse("format_mismatch");
  const { error, count } = await service.from("pm_reports")
    .update({ mvp_user_id: args.mvpUserId, mvp_note: args.mvpNote }, { count: "exact" })
    .eq("id", day.id).eq("status", "open").eq("format", "v2").is("superseded_at", null);
  if (error) throw new Error(`setMvpV2: ${error.message}`);
  if (count === 0) refuse("report_already_submitted");
}

// ─── after submit: the day's results ─────────────────────────────────────────

export interface PmResultsCell extends AveragedCell { label: string; labelEs: string | null; contributionsNamed: Array<{ authorName: string; grade: PmGrade | null; minutes: number }> }
export interface PmResultsPosition {
  positionId: string | null; name: string | null; nameEs: string | null;
  /** The mean of the criteria averages, for the summary row ("Expeditor · Great 2.6 · 2 managers"). */
  summary: { average: number | null; managers: number };
  cells: PmResultsCell[];
  writeIns: Array<{ authorName: string; text: string }>;
  themes: Theme[];
}
export interface PmDayResultsView {
  reportId: string; date: string; locationId: string; submittedByName: string | null; submittedAt: string | null;
  copies: Array<{ copyId: string; authorName: string; status: PmCopyStatus; observedFrom: string | null; observedTo: string | null;
    /** Both languages travel (Astra chunk F P3); the component resolves them by the reader's language. */
    entries: Array<{ subjectName: string; positionName: string | null; positionNameEs: string | null; criterion: string; criterionEs: string | null; grade: PmGrade | null }>;
    notes: Array<{ subjectName: string; positionName: string | null; positionNameEs: string | null; text: string }> }>;
  people: Array<{ subjectId: string; name: string; positions: PmResultsPosition[] }>;
}

/**
 * A SUBMITTED v2 day for those who may read it (`canReadPmDayResults`): the copies side by side (author,
 * window, status), per person × position × criterion the average with each manager's grade and minutes, the
 * write-ins attributed, and the "Coming up again" themes over the last 30 days for that person × position.
 */
export async function loadDayResults(service: SupabaseClient, args: { actor: PeopleActor; locationId: string; date: string; now?: Date }): Promise<PmDayResultsView | null> {
  requireUuid(args.locationId);
  if (args.actor.role === "social_media_mgr" || args.actor.level < 4) refuse("forbidden");
  const day = await loadDay(service, args.locationId, args.date);
  if (!day || day.format !== "v2") return null;
  const copies = await loadCopies(service, day.id);
  if (!canReadPmDayResults(args.actor, dayRef(day, copies))) refuse("forbidden");
  const copyIds = copies.map((c) => c.id);
  const [grades, notes, added, { positions }, criteria] = await Promise.all([
    loadLive<GradeRow>(service, "pm_copy_grades", "id, copy_id, location_id, subject_id, position_id, criterion_id, grade", copyIds),
    loadLive<NoteRow>(service, "pm_copy_notes", "id, copy_id, subject_id, position_id, note", copyIds),
    loadLive<AddedRow>(service, "pm_copy_positions", "id, copy_id, subject_id, position_id, reason", copyIds),
    loadShopPositions(service, args.locationId),
    loadCriteria(service, args.locationId, false),
  ]);
  const subjects = [...new Set([...grades.map((g) => g.subject_id), ...notes.map((n) => n.subject_id)])];
  const intervals = await loadDayIntervals(service, args.locationId, args.date, subjects, args.now);
  const names = await loadNames(service, [...subjects, ...copies.map((c) => c.author_id), ...(day.submitted_by ? [day.submitted_by] : [])]);
  const copyById = new Map(copies.map((c) => [c.id, c] as const));
  const posById = new Map(positions.map((p) => [p.id, p] as const));
  const critById = new Map(criteria.map((c) => [c.id, c] as const));

  const weights = new Map<string, number>();
  for (const g of grades) {
    const key = weightKey(g.copy_id, g.subject_id, g.position_id);
    if (weights.has(key)) continue;
    const copy = copyById.get(g.copy_id)!;
    const addedHere = g.position_id !== null && added.some((a) => a.copy_id === g.copy_id && a.subject_id === g.subject_id && a.position_id === g.position_id)
      && !intervals.some((i) => i.userId === g.subject_id && i.positionId === g.position_id);
    weights.set(key, observationMinutes({ copyId: copy.id, authorId: copy.author_id, from: copy.observed_from, to: copy.observed_to }, intervals, g.subject_id, g.position_id, { added: addedHere }));
  }
  const cells = averageGrades(grades.map((g) => ({ copyId: g.copy_id, authorId: copyById.get(g.copy_id)!.author_id, subjectId: g.subject_id, positionId: g.position_id, criterionId: g.criterion_id, grade: g.grade })), weights);
  const themesFor = await themeNotes(service, args.locationId, args.date, subjects);

  const people = subjects.map((subjectId) => {
    const keys = [...new Set([...cells.filter((c) => c.subjectId === subjectId).map((c) => c.positionId ?? ""), ...notes.filter((n) => n.subject_id === subjectId).map((n) => n.position_id ?? "")])];
    const positionsView: PmResultsPosition[] = keys.map((k) => {
      const positionId = k === "" ? null : k;
      const row = positionId ? posById.get(positionId) : undefined;
      const mine = cells.filter((c) => c.subjectId === subjectId && c.positionId === positionId).map((c) => {
        const cr = critById.get(c.criterionId);
        return { ...c, label: cr?.label ?? "", labelEs: cr?.label_es ?? null,
          contributionsNamed: c.contributions.map((x) => ({ authorName: names.get(x.authorId) ?? "", grade: x.grade, minutes: x.minutes })) };
      }).sort((a, b) => (critById.get(a.criterionId)?.sort ?? 0) - (critById.get(b.criterionId)?.sort ?? 0) || a.label.localeCompare(b.label));
      const averaged = mine.filter((c) => c.average !== null);
      const managers = new Set(mine.flatMap((c) => c.contributions.filter((x) => x.grade !== null).map((x) => x.authorId))).size;
      return {
        positionId, name: row?.name ?? null, nameEs: row?.name_es ?? null,
        summary: { average: averaged.length ? averaged.reduce((s, c) => s + (c.average as number), 0) / averaged.length : null, managers },
        cells: mine,
        writeIns: notes.filter((n) => n.subject_id === subjectId && n.position_id === positionId)
          .map((n) => ({ authorName: names.get(copyById.get(n.copy_id)!.author_id) ?? "", text: n.note })),
        themes: writeInThemes(themesFor(subjectId, positionId), { minAuthors: 2, minDays: 3, top: 3 }),
      };
    });
    return { subjectId, name: names.get(subjectId) ?? "", positions: positionsView };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.subjectId.localeCompare(b.subjectId));

  return {
    reportId: day.id, date: day.report_date, locationId: day.location_id,
    submittedByName: day.submitted_by ? names.get(day.submitted_by) ?? null : null, submittedAt: day.submitted_at,
    copies: copies.map((c) => ({
      copyId: c.id, authorName: names.get(c.author_id) ?? "", status: c.status, observedFrom: c.observed_from, observedTo: c.observed_to,
      entries: grades.filter((g) => g.copy_id === c.id).map((g) => ({
        subjectName: names.get(g.subject_id) ?? "",
        positionName: g.position_id ? posById.get(g.position_id)?.name ?? null : null,
        positionNameEs: g.position_id ? posById.get(g.position_id)?.name_es ?? null : null,
        criterion: critById.get(g.criterion_id)?.label ?? "", criterionEs: critById.get(g.criterion_id)?.label_es ?? null, grade: g.grade,
      })),
      notes: notes.filter((n) => n.copy_id === c.id).map((n) => ({
        subjectName: names.get(n.subject_id) ?? "",
        positionName: n.position_id ? posById.get(n.position_id)?.name ?? null : null,
        positionNameEs: n.position_id ? posById.get(n.position_id)?.name_es ?? null : null, text: n.note,
      })),
    })),
    people,
  };
}

/** The notes of SUBMITTED v2 days at the shop in the last 30 days for these subjects, attributed (the themes' input). */
async function themeNotes(service: SupabaseClient, locationId: string, date: string, subjects: readonly string[]): Promise<(subjectId: string, positionId: string | null) => AttributedNote[]> {
  if (!subjects.length) return () => [];
  const days = await selectAllRows<DayRow>((from, to) => service.from("pm_reports").select("*").eq("location_id", locationId).eq("format", "v2")
    .neq("status", "open").is("superseded_at", null).gte("report_date", etYmdMinusDays(date, PM_V2_THEME_DAYS - 1)).lte("report_date", date)
    .order("report_date", { ascending: true }).range(from, to));
  const copies: CopyRow[] = [];
  for (const d of days) copies.push(...await loadCopies(service, d.id));
  const notes = await loadLive<NoteRow>(service, "pm_copy_notes", "id, copy_id, subject_id, position_id, note", copies.map((c) => c.id), subjects);
  const names = await loadNames(service, copies.map((c) => c.author_id));
  const copyById = new Map(copies.map((c) => [c.id, c] as const));
  const dayById = new Map(days.map((d) => [d.id, d] as const));
  return (subjectId, positionId) => notes.filter((n) => n.subject_id === subjectId && n.position_id === positionId).map((n) => {
    const copy = copyById.get(n.copy_id)!;
    return { noteId: n.id, authorId: copy.author_id, authorName: names.get(copy.author_id) ?? null, day: dayById.get(copy.pm_report_id)?.report_date ?? "", text: n.note, subjectId, positionId };
  });
}

// ─── the subject's own feedback (R9) ─────────────────────────────────────────

export interface MyFeedbackV2Day {
  date: string; locationId: string;
  positions: Array<{ positionId: string | null; name: string | null; nameEs: string | null; criteria: Array<{ criterionId: string; label: string; labelEs: string | null; band: PmBand }> }>;
}

/**
 * The person's OWN grades from SUBMITTED v2 days, averaged per day × position × criterion (weighted by the
 * minutes each manager observed them), as BANDS. No author, no number, no note text (R9). Before 0271 is
 * applied it answers [] (the page shows v1 feedback only).
 */
export async function loadMyFeedbackV2(service: SupabaseClient, args: { userId: string }): Promise<MyFeedbackV2Day[]> {
  requireUuid(args.userId);
  let grades: GradeRow[];
  try {
    grades = await selectAllRows<GradeRow>((from, to) => service.from("pm_copy_grades")
      .select("id, copy_id, location_id, subject_id, position_id, criterion_id, grade").eq("subject_id", args.userId).is("superseded_at", null)
      .order("id", { ascending: true }).range(from, to));
  } catch (e) {
    if (isMissingTable({ message: e instanceof Error ? e.message : String(e) })) return [];
    throw e;
  }
  if (!grades.length) return [];
  const copies: CopyRow[] = [];
  for (const ids of chunk([...new Set(grades.map((g) => g.copy_id))])) {
    copies.push(...await selectAllRows<CopyRow>((from, to) => service.from("pm_report_copies")
      .select("id, pm_report_id, location_id, author_id, status, observed_from, observed_to, created_at, sealed_at").in("id", ids)
      .order("id", { ascending: true }).range(from, to)));
  }
  const days: DayRow[] = [];
  for (const ids of chunk([...new Set(copies.map((c) => c.pm_report_id))])) {
    days.push(...await selectAllRows<DayRow>((from, to) => service.from("pm_reports").select("*").in("id", ids).is("superseded_at", null)
      .order("id", { ascending: true }).range(from, to)));
  }
  const submitted = new Map(days.filter((d) => d.format === "v2" && d.status !== "open").map((d) => [d.id, d] as const));
  const copyById = new Map(copies.filter((c) => submitted.has(c.pm_report_id)).map((c) => [c.id, c] as const));
  const live = grades.filter((g) => copyById.has(g.copy_id));
  if (!live.length) return [];
  const out: MyFeedbackV2Day[] = [];
  const byDay = new Map<string, GradeRow[]>();
  for (const g of live) {
    const dayId = copyById.get(g.copy_id)!.pm_report_id;
    byDay.set(dayId, [...(byDay.get(dayId) ?? []), g]);
  }
  const shops = [...new Set([...submitted.values()].map((d) => d.location_id))];
  const posById = new Map<string, PositionRow>();
  const critById = new Map<string, CriterionRow>();
  for (const shop of shops) {
    for (const p of (await loadShopPositions(service, shop)).positions) posById.set(p.id, p);
    for (const c of await loadCriteria(service, shop, false)) critById.set(c.id, c);
  }
  for (const [dayId, rows] of byDay) {
    const day = submitted.get(dayId)!;
    const intervals = await loadDayIntervals(service, day.location_id, day.report_date, [args.userId]);
    const weights = new Map<string, number>();
    for (const g of rows) {
      const c = copyById.get(g.copy_id)!;
      weights.set(weightKey(c.id, g.subject_id, g.position_id), observationMinutes({ copyId: c.id, authorId: c.author_id, from: c.observed_from, to: c.observed_to }, intervals, g.subject_id, g.position_id,
        { added: g.position_id !== null && !intervals.some((i) => i.positionId === g.position_id) }));
    }
    const cells = averageGrades(rows.map((g) => ({ copyId: g.copy_id, authorId: copyById.get(g.copy_id)!.author_id, subjectId: g.subject_id, positionId: g.position_id, criterionId: g.criterion_id, grade: g.grade })), weights);
    const positionsMap = new Map<string, MyFeedbackV2Day["positions"][number]>();
    for (const cell of cells) {
      if (cell.average === null) continue;
      const k = cell.positionId ?? "";
      const row = cell.positionId ? posById.get(cell.positionId) : undefined;
      const entry = positionsMap.get(k) ?? { positionId: cell.positionId, name: row?.name ?? null, nameEs: row?.name_es ?? null, criteria: [] };
      const cr = critById.get(cell.criterionId);
      entry.criteria.push({ criterionId: cell.criterionId, label: cr?.label ?? "", labelEs: cr?.label_es ?? null, band: gradeBand(cell.average) });
      positionsMap.set(k, entry);
    }
    for (const p of positionsMap.values()) p.criteria.sort((a, b) => (critById.get(a.criterionId)?.sort ?? 0) - (critById.get(b.criterionId)?.sort ?? 0) || a.label.localeCompare(b.label));
    if (positionsMap.size) out.push({ date: day.report_date, locationId: day.location_id, positions: [...positionsMap.values()] });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.locationId.localeCompare(b.locationId)));
}
