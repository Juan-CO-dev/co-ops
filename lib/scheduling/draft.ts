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
export type DraftRun = { ran: false; reason: "not_wednesday_morning" | "no_shop_enabled" } | { ran: true; weekStart: string; shops: DraftShopOutcome[] };

async function log(action: "schedule.draft_auto" | "schedule.draft_skipped" | "schedule.generator_invalid", locationId: string, metadata: Record<string, unknown>): Promise<void> {
  await audit({ actorId: null, actorRole: null, action, resourceTable: "schedule_weeks", resourceId: locationId,
    metadata: { location_id: locationId, actor_context: "cron", ...metadata }, ipAddress: null, userAgent: null });
}

export async function runWednesdayDraft(deps: { service: SupabaseClient; now: Date; loadInputs?: LoadInputs }): Promise<DraftRun> {
  const et = operationalNow(deps.now);
  if (isoDowOf(et.date) !== DRAFT_ISO_DOW || Math.floor(et.minutesOfDay / 60) < DRAFT_EARLIEST_ET_HOUR) return { ran: false, reason: "not_wednesday_morning" };
  const shops = (await selectAllRows<{ location_id: string }>((f, t) => deps.service.from("schedule_shop_settings").select("location_id")
    .eq("enabled", true).order("location_id", { ascending: true }).range(f, t))).map((r) => r.location_id);
  if (shops.length === 0) return { ran: false, reason: "no_shop_enabled" };
  const weekStart = addDays(isoWeekStart(et.date), 7);
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
