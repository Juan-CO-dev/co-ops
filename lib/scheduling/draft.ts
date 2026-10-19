/**
 * THE WEDNESDAY DRAFT (Scheduling Phase 2, Task 19; J13, R3). A system act: no actor (`actor_context: "cron"`).
 *
 * Vercel calls the route at 10:15 and 11:15 UTC on Wednesdays; exactly one of those is at or after 6 AM ET in either
 * offset (EDT 06:15, EST 06:15), and the other finds nothing to do: this acts only when the ET date is a Wednesday and the
 * ET hour is ≥ 6. For every shop whose switch is ON it builds NEXT week only when that week has no revision; the 0275
 * writer's `head_moved` makes a second run idempotent ("already built" → skipped). Demand `unavailable` skips the shop
 * (audited `schedule.draft_skipped` with the cause; nothing written — an existing draft is never replaced); `no_history`
 * builds on the override / weekend / Normal order, flagged in the reasons. A generator throw is audited
 * `schedule.generator_invalid` and the shop is skipped (never committed). One shop's failure never stops the next.
 * Not in JOBS_REGISTRY (no email on a missed heartbeat); nothing here sends an email or a notification.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import { isMissingTable } from "@/lib/people/facts";
import { operationalNow } from "@/lib/midshift-shared";
import { selectAllRows } from "@/lib/supabase-paginate";
import { assertContextFits, canonicalJson, digest64, toContextSnapshot } from "./context-shared";
import { ScheduleError, type ScheduleErrorCode } from "./errors-shared";
import { GENERATOR_VERSION, buildWeek } from "./generator/build-shared";
import { loadSchedulingInputs } from "./inputs";
import { generatorInputFor, sqlStructureVersion } from "./inputs-shared";
import { commitRevisionCall } from "./rpc-args-shared";
import { problemsSummary, rpcRefusal, type LoadInputs } from "./schedules";
import { addDays, isoDowOf, isoWeekStart } from "./time-shared";

export const DRAFT_ISO_DOW = 3;
export const DRAFT_EARLIEST_ET_HOUR = 6;

export type DraftShopOutcome =
  | { locationId: string; outcome: "built"; weekStart: string; revisionId: string; demand: "ok" | "no_history" }
  | { locationId: string; outcome: "skipped"; weekStart: string; reason: "already_built" | ScheduleErrorCode | "error" };
export type DraftIdleReason = "not_ready" | "no_enabled_shops" | "not_wednesday_morning";
export type DraftRun = { ran: false; reason: DraftIdleReason } | { ran: true; weekStart: string; shops: DraftShopOutcome[] };
export type DraftPrecheck = { go: false; reason: DraftIdleReason } | { go: true; shops: string[]; weekStart: string };

/**
 * INERT UNTIL READY (Astra chunk E P1-2, CC chunk F GO). Read-only and BEFORE the lease (0275 owns the lease name
 * 'schedule-draft'; before it, claim_cron_route rejects the job): the readiness probe first — 0274
 * (`schedule_shop_settings`) and 0275 (`schedule_weeks`) present, else `not_ready` (prod right after merge, before the
 * applies: a clean skip, never a failure heartbeat); no settings row or every switch off → `no_enabled_shops`; then the
 * Wednesday-morning check. A missing relation is contained here; any other read error throws (a real failure).
 */
export async function draftPrecheck(deps: { service: SupabaseClient; now: Date }): Promise<DraftPrecheck> {
  let shops: string[];
  try {
    shops = (await selectAllRows<{ location_id: string }>((f, t) => deps.service.from("schedule_shop_settings").select("location_id")
      .eq("enabled", true).order("location_id", { ascending: true }).range(f, t))).map((r) => r.location_id);
  } catch (e) {
    if (isMissingTable({ message: e instanceof Error ? e.message : String(e) })) return { go: false, reason: "not_ready" };
    throw e;
  }
  const probe = await deps.service.from("schedule_weeks").select("id").limit(1);
  if (probe.error) {
    if (isMissingTable(probe.error)) return { go: false, reason: "not_ready" };
    throw new Error(`schedule_weeks probe: ${probe.error.message}`);
  }
  if (shops.length === 0) return { go: false, reason: "no_enabled_shops" };
  const et = operationalNow(deps.now);
  if (isoDowOf(et.date) !== DRAFT_ISO_DOW || Math.floor(et.minutesOfDay / 60) < DRAFT_EARLIEST_ET_HOUR) return { go: false, reason: "not_wednesday_morning" };
  return { go: true, shops, weekStart: addDays(isoWeekStart(et.date), 7) };
}

async function log(action: "schedule.draft_auto" | "schedule.draft_skipped" | "schedule.generator_invalid", locationId: string, metadata: Record<string, unknown>): Promise<void> {
  await audit({ actorId: null, actorRole: null, action, resourceTable: "schedule_weeks", resourceId: locationId,
    metadata: { location_id: locationId, actor_context: "cron", ...metadata }, ipAddress: null, userAgent: null });
}

export async function runWednesdayDraft(deps: { service: SupabaseClient; now: Date; loadInputs?: LoadInputs }): Promise<DraftRun> {
  const pre = await draftPrecheck(deps);
  if (!pre.go) return { ran: false, reason: pre.reason };
  const et = operationalNow(deps.now);
  const { shops, weekStart } = pre;
  const out: DraftShopOutcome[] = [];
  for (const locationId of shops) {
    try {
      const inputs = await (deps.loadInputs ?? loadSchedulingInputs)(deps.service, { locationId, weekStarts: [weekStart], now: deps.now });
      if (inputs.weeks[weekStart]?.headRevisionId) { out.push({ locationId, outcome: "skipped", weekStart, reason: "already_built" }); continue; }
      if (!inputs.shopSettings.enabled) { out.push({ locationId, outcome: "skipped", weekStart, reason: "shop_not_enabled" }); continue; }
      if (inputs.demand.kind === "unavailable") {
        await log("schedule.draft_skipped", locationId, { week_start: weekStart, code: "demand_unavailable", cause: inputs.demand.cause });
        out.push({ locationId, outcome: "skipped", weekStart, reason: "demand_unavailable" });
        continue;
      }
      const gi = generatorInputFor(inputs, weekStart, { today: et.date });
      let built;
      try {
        built = buildWeek(gi);
      } catch (e) {
        if (e instanceof ScheduleError && e.code === "generator_invalid_output") {
          await log("schedule.generator_invalid", locationId, { week_start: weekStart, params: e.params });
          out.push({ locationId, outcome: "skipped", weekStart, reason: "generator_invalid_output" });
          continue;
        }
        throw e;
      }
      assertContextFits(built.context);
      const snap = toContextSnapshot(built.context);
      const call = commitRevisionCall({
        actorId: null, locationId, weekStart, expectedHead: null, kind: "generated", structureVersionId: sqlStructureVersion(gi.structureVersionId),
        shifts: built.shifts, days: built.days.map((d) => ({ ...d, structureVersionId: sqlStructureVersion(d.structureVersionId) as string })), gaps: built.gaps,
        context: snap.context, reasons: built.reasons,
        meta: { actorContext: "cron", inputsDigest: digest64(canonicalJson(gi)), generatorVersion: GENERATOR_VERSION, problemsSummary: problemsSummary(built.problems), contextDigest: snap.digest },
      });
      const { data, error } = await deps.service.rpc(call.fn, call.args);
      if (error) {
        try { rpcRefusal(error); } catch (re) {
          if (re instanceof ScheduleError) {
            out.push({ locationId, outcome: "skipped", weekStart, reason: re.code === "head_moved" ? "already_built" : re.code });
            continue;
          }
          throw re;
        }
      }
      const revisionId = String((data as { revision_id: string }).revision_id);
      const demand = inputs.demand.kind === "ok" ? "ok" : "no_history";
      await log("schedule.draft_auto", locationId, { week_start: weekStart, revision_id: revisionId, demand, gaps: built.gaps.length, generator_version: GENERATOR_VERSION });
      out.push({ locationId, outcome: "built", weekStart, revisionId, demand });
    } catch (e) {
      out.push({ locationId, outcome: "skipped", weekStart, reason: e instanceof ScheduleError ? e.code : "error" });
    }
  }
  return { ran: true, weekStart, shops: out };
}
