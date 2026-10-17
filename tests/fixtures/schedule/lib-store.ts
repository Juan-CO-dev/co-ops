/**
 * Scheduling Phase 2, Tasks 17–19 — an in-memory shop for the schedules lib: the PostgREST fake (counts-fake-db) for
 * every table, plus FAKE definer RPCs that MIRROR the 0274 / 0275 writers' contract (head_moved, the confirmation
 * flag, the cron path, origin stamping, approval as a separate fact, unresolved_gaps / rules_failing) and store what
 * they are sent, so the loader reads it back exactly as it would from Postgres. The real SQL is proved by the PGlite
 * harnesses; this mirror proves the LIB sends what the writers need and reads back what they stored.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeDb, type Tables } from "../counts-fake-db";

export const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const GM = uid(1), AGM = uid(2), SMM = uid(3), MOO = uid(5), GM_B = uid(6);
export const STAFF = [uid(10), uid(11), uid(12), uid(13), uid(14), uid(15), uid(16), uid(17)];
export const KH = uid(18), SL = uid(19);
export const ST = uid(30), P_REG = uid(31), P_WALK = uid(32);

export function shopTables(opts: { enabled?: boolean } = {}): Tables {
  const people = [
    { id: GM, name: "Alex", role: "gm" }, { id: AGM, name: "Ana", role: "agm" }, { id: SMM, name: "Sam", role: "social_media_mgr" }, { id: MOO, name: "Cris", role: "moo" },
    { id: KH, name: "Kai", role: "key_holder" }, { id: SL, name: "Lee", role: "shift_lead" },
    ...STAFF.map((id, i) => ({ id, name: `Staff ${i}`, role: i % 3 === 0 ? "trainer" : "employee" })),
  ];
  return {
    users: [...people.map((p) => ({ ...p, active: true })), { id: GM_B, name: "John", role: "gm", active: true }],
    user_locations: [...people.filter((p) => p.id !== MOO).map((p) => ({ user_id: p.id, location_id: A, active: true, assigned_at: "2026-01-01T12:00:00Z" })),
      { user_id: GM_B, location_id: B, active: true, assigned_at: "2026-01-01T12:00:00Z" }],
    stations: [{ id: ST, location_id: A, name: "Line", name_es: "Línea", sort: 1, active: true, usually_closes_at: "21:00:00", trims: null }],
    station_positions: [
      { id: P_REG, station_id: ST, location_id: A, name: "Register", name_es: null, sort: 1, active: true, usually_trims_at: null },
      { id: P_WALK, station_id: ST, location_id: A, name: "Walk-ins", name_es: null, sort: 2, active: true, usually_trims_at: null },
    ],
    station_events: [], checklist_templates: [], checklist_instances: [], checklist_submissions: [], checklist_template_items: [], checklist_completions: [],
    productions: [], people_skill_adjustments: [], people_skill_ratings: [], people_skill_tunables: [], people_shop_settings: [],
    schedule_shop_settings: [{ location_id: A, enabled: opts.enabled ?? true, estimated_hourly_cents: 1800, estimated_salaried_weekly_cents: 120000, agm_access: "read" }],
    schedule_structures: [], schedule_person_settings: [], schedule_budget_entries: [], schedule_budget_days: [], schedule_day_types: [], schedule_pins: [],
    schedule_weeks: [], schedule_revisions: [], schedule_revision_shifts: [], schedule_revision_days: [], schedule_revision_gaps: [], schedule_revision_contexts: [],
    schedule_week_approvals: [], catering_pipeline: [], catering_quotes: [], ezcater_orders: [], toast_time_entries: [], audit_log: [],
  };
}

type Rpc = { data: unknown; error: { code?: string; message: string } | null };
export interface StoreOpts {
  /** The 0242 baseline the demand read gets (default: a successful EMPTY history = no_history). */
  baseline?: () => Promise<Rpc> | Rpc;
  /** ET today for the commit mirror's past_week / day rules (unused by the mirror unless set). */
  failCommitOnWeek?: string;
}

export function scheduleStore(tables: Tables, opts: StoreOpts = {}) {
  const fake = createFakeDb(tables);
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let tick = 0;
  let ids = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 21, 12, 0, tick++)).toISOString();
  const newId = () => `cccccccc-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
  const fail = (message: string): Rpc => ({ data: null, error: { message } });
  const t = (name: string) => (tables[name] ??= []);

  function commit(a: Record<string, unknown>): Rpc {
    const loc = a.p_location as string;
    const meta = a.p_meta as Record<string, unknown>;
    const settings = t("schedule_shop_settings").find((r) => r.location_id === loc);
    if (a.p_actor === null && (meta.actor_context !== "cron" || a.p_kind !== "generated")) return fail("schedule_forbidden");
    if ((a.p_kind === "generated") !== (a.p_expected_head === null)) return fail("invalid_payload");
    let week = t("schedule_weeks").find((w) => w.location_id === loc && w.week_start === a.p_week_start);
    if (!week) { week = { id: newId(), location_id: loc, week_start: a.p_week_start, head_revision_id: null, approved_revision_id: null }; t("schedule_weeks").push(week); }
    if ((week.head_revision_id ?? null) !== a.p_expected_head) return fail("head_moved");
    if (!settings?.enabled) return fail("shop_not_enabled");
    if (opts.failCommitOnWeek === a.p_week_start) return fail("history_changed");
    const revs = t("schedule_revisions").filter((r) => r.week_id === week!.id);
    const lastBuilt = [...revs].reverse().find((r) => r.kind !== "edited");
    const edited = revs.some((r) => r.kind === "edited" && (!lastBuilt || String(r.created_at) > String(lastBuilt.created_at)));
    if (a.p_kind === "regenerated" && edited && meta.confirmed_overwrite !== true) return fail("edited_week_unconfirmed");
    const rev = (meta.revision_id as string | undefined) ?? newId();
    t("schedule_revisions").push({ id: rev, week_id: week.id, location_id: loc, kind: a.p_kind, based_on_revision_id: week.head_revision_id, structure_version_id: a.p_structure_version,
      inputs_digest: meta.inputs_digest, generator_version: meta.generator_version, created_by: a.p_actor, actor_context: meta.actor_context, created_at: stamp(), problems_summary: meta.problems_summary });
    for (const d of a.p_days as Array<Record<string, unknown>>) {
      t("schedule_revision_days").push({ revision_id: rev, location_id: loc, business_date: d.date, origin_revision_id: d.inherited ? d.originRevisionId : rev,
        structure_version_id: d.structureVersionId, inherited: d.inherited, problems: d.problems });
    }
    for (const s of a.p_shifts as Array<Record<string, unknown>>) {
      t("schedule_revision_shifts").push({ revision_id: rev, location_id: loc, user_id: s.userId, business_date: s.date, start_q: s.startQ, end_q: s.endQ, segments: s.segments,
        closing_manager: s.closingManager, flex: s.flex, pinned: s.pinned, reasons: s.reasons ?? null });
    }
    for (const g of a.p_gaps as Array<Record<string, unknown>>) {
      t("schedule_revision_gaps").push({ revision_id: rev, location_id: loc, business_date: g.date, code: g.code, position_id: g.positionId, from_q: g.fromQ, to_q: g.toQ, cause: g.cause, certificate: g.certificate });
    }
    t("schedule_revision_contexts").push({ revision_id: rev, location_id: loc, context: JSON.parse(JSON.stringify(a.p_context)), context_digest: meta.context_digest });
    week.head_revision_id = rev;
    return { data: { revision_id: rev, week_id: week.id, kind: a.p_kind }, error: null };
  }

  function approve(a: Record<string, unknown>): Rpc {
    const week = t("schedule_weeks").find((w) => w.location_id === a.p_location && w.week_start === a.p_week_start);
    if (!week?.head_revision_id) return fail("week_not_found");
    if (week.head_revision_id !== a.p_expected_head) return fail("head_moved");
    const head = week.head_revision_id;
    if (t("schedule_revision_gaps").some((g) => g.revision_id === head && g.cause === "unresolved_search")) return fail("unresolved_gaps");
    if (t("schedule_revision_days").some((d) => d.revision_id === head && !d.inherited
      && (d.problems as Array<{ severity: string; inherited?: boolean }>).some((p) => p.severity === "error" && !p.inherited))) return fail("rules_failing");
    if (week.approved_revision_id === head) return { data: { approval_id: null, revision_id: head, already_approved: true }, error: null };
    const id = newId();
    t("schedule_week_approvals").push({ id, week_id: week.id, location_id: a.p_location, revision_id: head, approved_by: a.p_actor });
    week.approved_revision_id = head;
    return { data: { approval_id: id, revision_id: head, already_approved: false }, error: null };
  }

  async function rpc(fn: string, args: Record<string, unknown>): Promise<Rpc> {
    calls.push({ fn, args });
    switch (fn) {
      case "pulse_sales_baseline": return opts.baseline ? await opts.baseline() : { data: { hours: [], captured_days: [] }, error: null };
      case "sales_report_daily": return { data: null, error: null };
      case "commit_schedule_revision": return commit(args);
      case "approve_schedule_week": return approve(args);
      case "save_schedule_structure": {
        const live = t("schedule_structures").filter((r) => r.location_id === args.p_location).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))[0];
        if ((live?.id ?? null) !== args.p_expected) return fail("structure_moved");
        const id = newId();
        t("schedule_structures").push({ id, location_id: args.p_location, structure: args.p_structure, created_at: stamp() });
        return { data: { before_id: live?.id ?? null, after_id: id }, error: null };
      }
      case "save_schedule_shop_settings": {
        const before = t("schedule_shop_settings").find((r) => r.location_id === args.p_location) ?? null;
        const after = { location_id: args.p_location, enabled: args.p_enabled, estimated_hourly_cents: args.p_estimated_hourly_cents,
          estimated_salaried_weekly_cents: args.p_estimated_salaried_weekly_cents, agm_access: args.p_agm_access };
        tables.schedule_shop_settings = [...t("schedule_shop_settings").filter((r) => r.location_id !== args.p_location), after];
        return { data: { before, after }, error: null };
      }
      case "record_schedule_budget_entry": {
        const id = newId();
        t("schedule_budget_entries").push({ id, location_id: args.p_location, scope: args.p_scope, week_start: args.p_week_start, month: args.p_month, hours: args.p_hours,
          source: args.p_source, suggestion_digest: args.p_digest, apportioned_by: args.p_apportioned_by, created_at: stamp() });
        for (const d of args.p_days as Array<{ date: string; hours: number }>) t("schedule_budget_days").push({ entry_id: id, location_id: args.p_location, business_date: d.date, hours: d.hours });
        return { data: { id, dates: (args.p_days as unknown[]).length }, error: null };
      }
      case "record_schedule_day_type": {
        const id = newId();
        t("schedule_day_types").push({ id, location_id: args.p_location, business_date: args.p_date, day_type: args.p_day_type, created_at: stamp() });
        return { data: { id }, error: null };
      }
      case "record_schedule_pin": return { data: { id: newId() }, error: null };
      case "record_schedule_person_settings": return { data: { id: newId(), before: null, after: { user_id: args.p_user } }, error: null };
      default: return fail(`unknown rpc ${fn}`);
    }
  }

  const client = {
    from: fake.client.from,
    rpc: (fn: string, args: Record<string, unknown>) => { const p = rpc(fn, args); return Object.assign(p, { abortSignal: () => p }); },
  } as unknown as SupabaseClient;
  return { client, calls, tables, newId };
}

/** A client whose EVERY read and RPC throws: proves an act refused before any I/O. */
export function noIoClient(): SupabaseClient {
  return { from: (t: string) => { throw new Error(`I/O before the permission check: from(${t})`); }, rpc: (f: string) => { throw new Error(`I/O before the permission check: rpc(${f})`); } } as unknown as SupabaseClient;
}
