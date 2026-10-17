/**
 * THE PEOPLE FACT LOADER — the ONE batch loader every people number is computed from.
 *
 * Scheduling Phase 1, Task 11 Step 2. The queries are the legacy ones from lib/team-metrics.ts,
 * moved VERBATIM: the same tables, filters, 50-id chunking and `selectAllRows` paging, in the same
 * order. A team load and a person load differ exactly where the legacy loaders differed (a person
 * load filters each family to that person). Two deliberate column additions, both so ONE load can
 * serve a compare's two windows: the finalized-report reads also select `report_date`, and the
 * grade read selects `pm_report_id`, so the pure rules can date each row to its window.
 *
 * A new consumer of people facts goes through `loadPeopleFacts`, never its own query.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRows } from "@/lib/supabase-paginate";
import {
  emptyPeopleFacts, type CashFact, type CompletionFact, type ConfirmationFact, type DatedReportFact, type FactFamily,
  type FactSubject, type FactWindow, type InstanceFact, type OversightFact, type PeopleFacts, type PmGradeFact,
  type PmNoteFact, type PmReportFact, type ProfileFacts, type StationFact, type PositionFact, type StationEventFact,
  type ClosingInstanceFact, type ClosingItemFact, type ClosingCompletionFact, type SkillAdjustmentFact, type SkillRatingFact,
  emptyPmV2Facts, type PmV2CopyFact, type PmV2DayFact, type PmV2GradeFact, type PmV2NoteFact,
} from "@/lib/people/facts-shared";
import { OVERSIGHT_ACTIONS } from "@/lib/people/performance-shared";

const FINALIZED_PM_STATUSES = ["submitted", "incomplete_confirmed", "auto_finalized"];
const ID_CHUNK = 50;

export interface PeopleFactScope {
  locationId: string;
  subject: FactSubject;
  window: FactWindow;
  families: readonly FactFamily[];
}

/** Loads exactly the families asked for (and the instances any of them is bound by). */
export async function loadPeopleFacts(service: SupabaseClient, scope: PeopleFactScope): Promise<PeopleFacts> {
  const { locationId, subject, window } = scope;
  const want = new Set(scope.families);
  const facts = emptyPeopleFacts(locationId, subject, window);
  const loaded = new Set<FactFamily>();
  const { start, end } = window.bounds;
  const person = subject.kind === "person" ? subject.personId : null;

  // Location instance ids bind completions and oversight events by their event time.
  // An event in this window can refer to an instance dated before it.
  if (want.has("instances") || want.has("completions") || want.has("oversight")) {
    facts.instances = person === null
      ? await selectAllRows<InstanceFact>(
        (from, to) => service
          .from("checklist_instances").select("id, confirmed_by, confirmed_at")
          .eq("location_id", locationId)
          .order("id", { ascending: true }).range(from, to),
      )
      : await selectAllRows<InstanceFact>(
        (from, to) => service
          .from("checklist_instances").select("id").eq("location_id", locationId)
          .order("id", { ascending: true }).range(from, to),
      );
    loaded.add("instances");
  }
  const instanceIds = facts.instances.map((r) => r.id);

  // TASKS + NOTES (completions: completed_at in span, live, instance at location)
  if (want.has("completions")) {
    for (let i = 0; i < instanceIds.length; i += ID_CHUNK) {
      const chunk = instanceIds.slice(i, i + ID_CHUNK);
      const rows = person === null
        ? await selectAllRows<CompletionFact>(
          (from, to) => service
            .from("checklist_completions")
            .select("instance_id, template_item_id, completed_by, completed_at, notes")
            .in("instance_id", chunk)
            .gte("completed_at", start).lt("completed_at", end)
            .is("superseded_at", null).is("revoked_at", null)
            .order("completed_at", { ascending: true }).order("id", { ascending: true }).range(from, to),
        )
        : await selectAllRows<CompletionFact>(
          (from, to) => service
            .from("checklist_completions").select("instance_id, template_item_id, completed_at, notes")
            .eq("completed_by", person).in("instance_id", chunk)
            .gte("completed_at", start).lt("completed_at", end)
            .is("superseded_at", null).is("revoked_at", null)
            .order("completed_at", { ascending: true }).order("id", { ascending: true }).range(from, to),
        );
      facts.completions.push(...rows);
    }
    loaded.add("completions");
  }

  // FINALIZATIONS — a person's confirmed instances (a team reads them off the instances)
  if (want.has("confirmations")) {
    if (person === null) throw new Error("confirmations_need_a_person");
    facts.confirmations = await selectAllRows<ConfirmationFact>(
      (from, to) => service
        .from("checklist_instances").select("date, confirmed_at")
        .eq("location_id", locationId).eq("confirmed_by", person).not("confirmed_at", "is", null)
        .gte("confirmed_at", start).lt("confirmed_at", end)
        .order("id", { ascending: true }).range(from, to),
    );
    loaded.add("confirmations");
  }

  // Paginate past the 1000-row cap (WB5-06: the same silent-truncation class over the same growth
  // tables at the location+window grain).
  if (want.has("cash")) {
    facts.cash = person === null
      ? await selectAllRows<CashFact>(
        (from, to) => service
          .from("cash_reports").select("signed_by, signed_at, over_short_note")
          .eq("location_id", locationId).is("superseded_at", null)
          .gte("signed_at", start).lt("signed_at", end)
          .order("id", { ascending: true }).range(from, to),
      )
      : await selectAllRows<CashFact>(
        (from, to) => service
          .from("cash_reports").select("signed_at, over_short_note, report_date")
          .eq("location_id", locationId).eq("signed_by", person).is("superseded_at", null)
          .gte("signed_at", start).lt("signed_at", end)
          .order("id", { ascending: true }).range(from, to),
      );
    loaded.add("cash");
  }

  if (want.has("pmReports") || want.has("pmNotes")) {
    facts.pmReports = person === null
      ? await selectAllRows<PmReportFact>(
        (from, to) => service
          .from("pm_reports").select("id, submitted_by, submitted_at")
          .eq("location_id", locationId).is("superseded_at", null)
          .gte("submitted_at", start).lt("submitted_at", end)
          .order("id", { ascending: true }).range(from, to),
      )
      : await selectAllRows<PmReportFact>(
        (from, to) => service
          .from("pm_reports").select("id, submitted_at, report_date")
          .eq("location_id", locationId).eq("submitted_by", person).is("superseded_at", null)
          .gte("submitted_at", start).lt("submitted_at", end)
          .order("id", { ascending: true }).range(from, to),
      );
    loaded.add("pmReports");
  }

  // NOTES from pm evals (authored by the report submitter)
  if (want.has("pmNotes")) {
    // Chunked (chunk D review, Astra P2): a compare's union load carries BOTH windows' report ids, and
    // one `.in(...)` over 240 of them overflows the 8 KB request line. Every consumer counts, so the
    // concatenated chunks give the same numbers.
    const reportIds = facts.pmReports.map((r) => r.id);
    for (let i = 0; i < reportIds.length; i += ID_CHUNK) {
      const chunk = reportIds.slice(i, i + ID_CHUNK);
      const rows = person === null
        ? await selectAllRows<PmNoteFact>(
          (from, to) => service
            .from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
            .in("pm_report_id", chunk).is("superseded_at", null)
            .order("pm_report_id", { ascending: true }).order("id", { ascending: true }).range(from, to),
        )
        : await selectAllRows<PmNoteFact>(
          (from, to) => service
            .from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
            .in("pm_report_id", chunk).is("superseded_at", null)
            .order("id", { ascending: true }).range(from, to),
        );
      facts.pmNotes.push(...rows);
    }
    loaded.add("pmNotes");
  }

  // OVERSIGHT (audit_log by actor, bound to this location's instances in the pure rules;
  // audit_log grows fastest, so paginate)
  if (want.has("oversight")) {
    if (person === null) {
      const memberIds = [...(subject as { memberIds: readonly string[] }).memberIds];
      facts.oversight = await selectAllRows<OversightFact>(
        (from, to) => service
          .from("audit_log").select("actor_id, action, occurred_at, resource_table, resource_id, metadata")
          .in("actor_id", memberIds).in("action", OVERSIGHT_ACTIONS)
          .gte("occurred_at", start).lt("occurred_at", end)
          .order("id", { ascending: true }).range(from, to),
      );
    } else {
      facts.oversight = await selectAllRows<OversightFact>(
        (from, to) => service
          .from("audit_log").select("occurred_at, resource_table, resource_id, metadata")
          .eq("actor_id", person).in("action", OVERSIGHT_ACTIONS)
          .gte("occurred_at", start).lt("occurred_at", end)
          .order("id", { ascending: true }).range(from, to),
      );
    }
    loaded.add("oversight");
  }

  // PM v1 grades of the person, on the shop's finalized reports dated in the window
  if (want.has("pmGrades")) {
    if (person === null) throw new Error("pm_grades_need_a_person");
    facts.pmGradedReports = await selectAllRows<DatedReportFact>(
      (from, to) => service
        .from("pm_reports").select("id, report_date").eq("location_id", locationId).is("superseded_at", null)
        .in("status", FINALIZED_PM_STATUSES)
        .gte("report_date", window.dates.from).lte("report_date", window.dates.to)
        .order("id", { ascending: true }).range(from, to),
    );
    const repIds = facts.pmGradedReports.map((r) => r.id);
    for (let i = 0; i < repIds.length; i += ID_CHUNK) { // chunked: the same request-line ceiling as the notes
      const chunk = repIds.slice(i, i + ID_CHUNK);
      facts.pmGrades.push(...await selectAllRows<PmGradeFact>(
        (from, to) => service
          .from("pm_employee_evals").select("pm_report_id, arrived_ready, attitude, production, team_player, area_to_improve")
          .in("pm_report_id", chunk).eq("employee_id", person).is("superseded_at", null)
          .order("id", { ascending: true }).range(from, to),
      ));
    }
    loaded.add("pmGrades");
  }

  if (want.has("mvps")) {
    if (person === null) throw new Error("mvps_need_a_person");
    facts.mvps = await selectAllRows<DatedReportFact>(
      (from, to) => service
        .from("pm_reports").select("id, report_date").eq("location_id", locationId).eq("mvp_user_id", person).is("superseded_at", null)
        .in("status", FINALIZED_PM_STATUSES)
        .gte("report_date", window.dates.from).lte("report_date", window.dates.to)
        .order("id", { ascending: true }).range(from, to),
    );
    loaded.add("mvps");
  }

  await loadSkillFamilies(service, scope, want, facts, loaded);
  await loadPmV2Families(service, scope, want, facts, loaded);
  return { ...facts, loaded };
}

// ─── PM v2 (Task 23) ─────────────────────────────────────────────────────────
// SUBMITTED v2 days only: format 'v2', a finalized status, live. A day is dated by its business date for grades
// (the v1 grade rule's twin) and by its submit instant for notes (the v1 notes rule's twin). Before 0271 is
// applied (no `format` column, no copy tables) every family is EMPTY — never an error: the skills and the legacy
// numbers keep working on a database that has not got PM v2 yet.

async function loadPmV2Families(
  service: SupabaseClient, scope: PeopleFactScope, want: ReadonlySet<FactFamily>, facts: PeopleFacts, loaded: Set<FactFamily>,
): Promise<void> {
  const wantGrades = want.has("pmV2Grades"), wantNotes = want.has("pmV2Notes");
  if (!wantGrades && !wantNotes) return;
  const { locationId, subject, window } = scope;
  const person = subject.kind === "person" ? subject.personId : null;
  const members = new Set(subject.kind === "team" ? subject.memberIds : [person as string]);
  const cols = "id, report_date, submitted_at";
  try {
    const byId = new Map<string, PmV2DayFact>();
    if (wantGrades) {
      for (const d of await selectAllRows<PmV2DayFact>((from, to) => service
        .from("pm_reports").select(cols).eq("location_id", locationId).eq("format", "v2").is("superseded_at", null)
        .in("status", FINALIZED_PM_STATUSES).gte("report_date", window.dates.from).lte("report_date", window.dates.to)
        .order("id", { ascending: true }).range(from, to))) byId.set(d.id, d);
    }
    if (wantNotes) {
      for (const d of await selectAllRows<PmV2DayFact>((from, to) => service
        .from("pm_reports").select(cols).eq("location_id", locationId).eq("format", "v2").is("superseded_at", null)
        .in("status", FINALIZED_PM_STATUSES).gte("submitted_at", window.bounds.start).lt("submitted_at", window.bounds.end)
        .order("id", { ascending: true }).range(from, to))) byId.set(d.id, d);
    }
    const v2 = facts.pmV2;
    v2.days = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const ids of chunk(v2.days.map((d) => d.id), ID_CHUNK)) {
      v2.copies.push(...await selectAllRows<PmV2CopyFact>((from, to) => service
        .from("pm_report_copies").select("id, pm_report_id, author_id, observed_from, observed_to").in("pm_report_id", ids)
        .order("id", { ascending: true }).range(from, to)));
    }
    if (wantGrades) {
      for (const ids of chunk(v2.copies.map((c) => c.id), ID_CHUNK)) {
        const rows = await selectAllRows<PmV2GradeFact>((from, to) => {
          const q = service.from("pm_copy_grades").select("id, copy_id, subject_id, position_id, criterion_id, grade").in("copy_id", ids).is("superseded_at", null);
          return (person !== null ? q.eq("subject_id", person) : q).order("id", { ascending: true }).range(from, to);
        });
        v2.grades.push(...rows.filter((g) => members.has(g.subject_id)));
      }
    }
    if (wantNotes) {
      // Only the subject's OWN copies: a note counts for the manager who wrote it.
      const authored = v2.copies.filter((c) => members.has(c.author_id)).map((c) => c.id);
      for (const ids of chunk(authored, ID_CHUNK)) {
        v2.notes.push(...await selectAllRows<PmV2NoteFact>((from, to) => service
          .from("pm_copy_notes").select("id, copy_id").in("copy_id", ids).is("superseded_at", null)
          .order("id", { ascending: true }).range(from, to)));
      }
    }
  } catch (e) {
    if (!isMissingTable({ message: e instanceof Error ? e.message : String(e) })) throw e;
    facts.pmV2 = emptyPmV2Facts();
  }
  if (wantGrades) loaded.add("pmV2Grades");
  if (wantNotes) loaded.add("pmV2Notes");
}

// ─── the skill families (Task 16) ────────────────────────────────────────────
// Read ONLY when lib/people/skills.ts asks; no legacy number reads them, so the golden cannot move.

/** A 0270 table is not there yet (deploy before apply): the skills surfaces show "not available". */
export class SkillsUnavailableError extends Error {
  constructor() { super("skills_unavailable"); }
}
/** True when a PostgREST / Postgres error says the table does not exist (yet). */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /does not exist|could not find the table/i.test(error.message ?? "");
}
/** A read of a 0270 table: a missing table is `skills_unavailable`, any other error throws. */
async function people0270<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: { code?: string; message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) {
      if (isMissingTable(error)) throw new SkillsUnavailableError();
      throw new Error(`people 0270 read: ${error.message}`);
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

/** `productions` at a shop: lib/yield-stats.ts loadBatches' columns and filters, bounded by [start, end). */
export const PRODUCTION_FACT_COLUMNS = "id, output_item_id, produced_at, made_by, batches_made, came_out_to, yield_at_time";

async function loadSkillFamilies(
  service: SupabaseClient, scope: PeopleFactScope, want: ReadonlySet<FactFamily>, facts: PeopleFacts, loaded: Set<FactFamily>,
): Promise<void> {
  const { locationId, subject, window } = scope;
  const { start, end } = window.bounds;
  const person = subject.kind === "person" ? subject.personId : null;
  const memberIds = subject.kind === "team" ? [...subject.memberIds] : [];
  const s = facts.skills;

  if (want.has("shopPositions")) {
    s.stations = await selectAllRows<StationFact>((from, to) => service
      .from("stations").select("id, name, name_es, sort, active, usually_closes_at").eq("location_id", locationId)
      .order("id", { ascending: true }).range(from, to));
    s.positions = await selectAllRows<PositionFact>((from, to) => service
      .from("station_positions").select("id, station_id, name, name_es, sort, active").eq("location_id", locationId)
      .order("id", { ascending: true }).range(from, to));
    loaded.add("shopPositions");
  }

  if (want.has("positionIntervals")) {
    type Row = { id: string; sequence: string | number; location_id: string; business_date: string; user_id: string; station_id: string | null;
      position_id: string | null; kind: StationEventFact["kind"]; at: string; source: StationEventFact["source"]; effective_at: string | null;
      reason_code: string | null };
    const cols = "id, sequence, location_id, business_date, user_id, station_id, position_id, kind, at, source, effective_at, reason_code";
    const rows: Row[] = [];
    const groups = person !== null ? [[person]] : chunk(memberIds, ID_CHUNK);
    for (const ids of groups) {
      rows.push(...await selectAllRows<Row>((from, to) => service
        .from("station_events").select(cols).eq("location_id", locationId).in("user_id", ids)
        .gte("business_date", window.dates.from).lte("business_date", window.dates.to)
        .order("sequence", { ascending: true }).range(from, to)));
    }
    s.stationEvents = rows.map((r) => ({
      id: r.id, sequence: String(r.sequence), locationId: r.location_id, businessDate: r.business_date, userId: r.user_id,
      stationId: r.station_id, positionId: r.position_id, kind: r.kind, at: r.at, source: r.source, effectiveAt: r.effective_at,
      reasonCode: r.reason_code ?? null,
    }));
    loaded.add("positionIntervals");
  }

  if (want.has("closingLines")) {
    const templates = await selectAllRows<{ id: string }>((from, to) => service
      .from("checklist_templates").select("id").eq("location_id", locationId).eq("type", "closing")
      .order("id", { ascending: true }).range(from, to));
    const templateIds = templates.map((t) => t.id);
    for (const ids of chunk(templateIds, ID_CHUNK)) {
      s.closingInstances.push(...await selectAllRows<ClosingInstanceFact>((from, to) => service
        .from("checklist_instances").select("id, date, template_id, shift_start_at, triggered_at")
        .eq("location_id", locationId).in("template_id", ids).is("dropped_at", null)
        .gte("date", window.dates.from).lte("date", window.dates.to)
        .order("id", { ascending: true }).range(from, to)));
      s.closingItems.push(...await selectAllRows<ClosingItemFact>((from, to) => service
        .from("checklist_template_items").select("id, template_id, station, active").in("template_id", ids)
        .order("id", { ascending: true }).range(from, to)));
    }
    // EVERY live completion at those instances (a closure needs all of a station's lines, by anyone).
    for (const ids of chunk(s.closingInstances.map((i) => i.id), ID_CHUNK)) {
      s.closingCompletions.push(...await selectAllRows<ClosingCompletionFact>((from, to) => service
        .from("checklist_completions").select("id, instance_id, template_item_id, completed_by, completed_at")
        .in("instance_id", ids).is("superseded_at", null).is("revoked_at", null)
        .order("id", { ascending: true }).range(from, to)));
    }
    if (!want.has("shopPositions")) {
      s.stations = await selectAllRows<StationFact>((from, to) => service
        .from("stations").select("id, name, name_es, sort, active, usually_closes_at").eq("location_id", locationId)
        .order("id", { ascending: true }).range(from, to));
    }
    loaded.add("closingLines");
  }

  // Scheduling Phase 2 (Task 16): OPT-IN, over the closing instances closingLines loaded — never read by a legacy number.
  if (want.has("closingFinalization")) {
    if (!want.has("closingLines")) throw new Error("loadPeopleFacts: closingFinalization requires closingLines");
    const ids = s.closingInstances.map((i) => i.id);
    const status: Array<{ id: string; status: string; confirmed_at: string | null }> = [];
    const finals = new Set<string>();
    for (const part of chunk(ids, ID_CHUNK)) {
      status.push(...await selectAllRows<{ id: string; status: string; confirmed_at: string | null }>((from, to) => service
        .from("checklist_instances").select("id, status, confirmed_at").in("id", part)
        .order("id", { ascending: true }).range(from, to)));
      for (const r of await selectAllRows<{ instance_id: string }>((from, to) => service
        .from("checklist_submissions").select("instance_id").in("instance_id", part).eq("is_final_confirmation", true)
        .order("instance_id", { ascending: true }).range(from, to))) finals.add(r.instance_id);
    }
    s.closingStatus = status.map((r) => ({ id: r.id, status: r.status, confirmed_at: r.confirmed_at, final_confirmation: finals.has(r.id) }));
    loaded.add("closingFinalization");
  }

  if (want.has("productionFacts")) {
    // r1 P2-6: productions ALONE (no prep_batch_sessions join), EXACTLY loadBatches' columns and filters;
    // one row = one observation. Every maker's rows (a no-maker row is counted as evidence).
    type Row = { id: string; output_item_id: string; produced_at: string; made_by: string | null; batches_made: number | string | null; came_out_to: number | string | null; yield_at_time: number | string | null };
    const rows = await selectAllRows<Row>((from, to) => service
      .from("productions").select(PRODUCTION_FACT_COLUMNS)
      .eq("location_id", locationId)
      .is("superseded_at", null).is("revoked_at", null)
      .gt("batches_made", 0)
      .not("came_out_to", "is", null).not("yield_at_time", "is", null)
      .gte("produced_at", start).lt("produced_at", end)
      .order("produced_at", { ascending: false }).order("id", { ascending: false }).range(from, to));
    for (const r of rows) {
      const batchesMade = numOrNull(r.batches_made), cameOutTo = numOrNull(r.came_out_to), yieldAtTime = numOrNull(r.yield_at_time);
      if (batchesMade === null || cameOutTo === null || yieldAtTime === null) continue;
      s.productions.push({ id: r.id, itemId: r.output_item_id, producedAt: r.produced_at, madeBy: r.made_by, batchesMade, cameOutTo, yieldAtTime });
    }
    loaded.add("productionFacts");
  }

  if (want.has("skillAdjustments")) {
    const cols = "id, user_id, position_id, delta, reason_code, reason_note, actor_id, created_at";
    const rows = await people0270<SkillAdjustmentFact>((from, to) => {
      const q = service.from("people_skill_adjustments").select(cols).eq("location_id", locationId);
      return (person !== null ? q.eq("user_id", person) : q).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
    });
    s.adjustments = rows.map((r) => ({ ...r, delta: Number(r.delta) }));
    loaded.add("skillAdjustments");
  }

  if (want.has("skillRatings")) {
    const cols = "id, user_id, position_id, rating, reason_code, reason_note, actor_id, created_at";
    const rows = await people0270<SkillRatingFact>((from, to) => {
      const q = service.from("people_skill_ratings").select(cols).eq("location_id", locationId);
      return (person !== null ? q.eq("user_id", person) : q).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
    });
    s.ratings = rows.map((r) => ({ ...r, rating: Number(r.rating) }));
    loaded.add("skillRatings");
  }

  if (want.has("skillTunables")) {
    const rows = await people0270<{ location_id: string | null; tunables: unknown }>((from, to) => service
      .from("people_skill_tunables").select("location_id, tunables").or(`location_id.is.null,location_id.eq.${locationId}`)
      .order("id", { ascending: true }).range(from, to));
    s.tunables = { company: rows.find((r) => r.location_id === null)?.tunables ?? null, shop: rows.find((r) => r.location_id === locationId)?.tunables ?? null };
    loaded.add("skillTunables");
  }

  if (want.has("shopSettings")) {
    const rows = await people0270<{ pm_v2: boolean; prep_position_id: string | null }>((from, to) => service
      .from("people_shop_settings").select("pm_v2, prep_position_id").eq("location_id", locationId)
      .order("location_id", { ascending: true }).range(from, to));
    s.settings = rows[0] ? { pmV2: rows[0].pm_v2 === true, prepPositionId: rows[0].prep_position_id } : null;
    loaded.add("shopSettings");
  }
}

function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * The public profile card's facts (Task 12): the target's live completions (all time, every shop),
 * the live MVP count, and the target's live PM v1 grades — the queries moved verbatim from
 * lib/profiles.ts `loadPublicProfile`, in the same order.
 */
export async function loadProfileFacts(service: SupabaseClient, targetUserId: string): Promise<ProfileFacts> {
  const completions = await selectAllRows<{ completed_at: string }>(
    (from, to) => service.from("checklist_completions").select("completed_at")
      .eq("completed_by", targetUserId).is("superseded_at", null).is("revoked_at", null)
      .order("completed_at", { ascending: true }).range(from, to),
  );
  const { count: mvpCount } = await service
    .from("pm_reports").select("id", { count: "exact", head: true })
    .eq("mvp_user_id", targetUserId).is("superseded_at", null);
  const grades = await selectAllRows<ProfileFacts["grades"][number]>(
    (from, to) => service.from("pm_employee_evals").select("arrived_ready, attitude, production, team_player")
      .eq("employee_id", targetUserId).is("superseded_at", null)
      .order("pm_report_id", { ascending: true }).range(from, to),
  );
  return { completions, mvpCount: mvpCount ?? 0, grades };
}
