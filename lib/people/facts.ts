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
  type PmNoteFact, type PmReportFact, type ProfileFacts,
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
    const reportIds = facts.pmReports.map((r) => r.id);
    if (reportIds.length) {
      facts.pmNotes = person === null
        ? await selectAllRows<PmNoteFact>(
          (from, to) => service
            .from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
            .in("pm_report_id", reportIds).is("superseded_at", null)
            .order("pm_report_id", { ascending: true }).order("id", { ascending: true }).range(from, to),
        )
        : await selectAllRows<PmNoteFact>(
          (from, to) => service
            .from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
            .in("pm_report_id", reportIds).is("superseded_at", null)
            .order("id", { ascending: true }).range(from, to),
        );
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
    if (repIds.length) {
      facts.pmGrades = await selectAllRows<PmGradeFact>(
        (from, to) => service
          .from("pm_employee_evals").select("pm_report_id, arrived_ready, attitude, production, team_player, area_to_improve")
          .in("pm_report_id", repIds).eq("employee_id", person).is("superseded_at", null)
          .order("id", { ascending: true }).range(from, to),
      );
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

  return { ...facts, loaded };
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
