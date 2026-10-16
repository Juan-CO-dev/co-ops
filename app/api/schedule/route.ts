import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { peopleActorFromAuth } from "@/lib/people/access-shared";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { stepUpFor } from "@/lib/scheduling/access-shared";
import { ScheduleError, scheduleErrorStatus } from "@/lib/scheduling/errors-shared";
import { SCHEDULE_ACTIONS, exactShape } from "@/lib/scheduling/route-shapes-shared";
import type { EditOp } from "@/lib/scheduling/edit-shared";
import type { HorizonRequest } from "@/lib/scheduling/horizon-shared";
import { applyHorizon, approveWeek, generateWeek, previewHorizon, saveEdit } from "@/lib/scheduling/schedules";
import { acceptBudgetSuggestion, keepBudget, recordPersonSettings, setBudget, setDayType, setPin, type PersonSettingsInput } from "@/lib/scheduling/settings";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;


const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const strOrNull = (v: unknown) => v === null || isStr(v);

/**
 * Scheduling Phase 2, Task 18 — the schedule board's acts. Session (401), same-origin (403 bad_origin), the exact body
 * shape (400 bad_request). The STEP-UP TIER is decided HERE, before the lib runs (J12): approve → Tier B; a rebuild that
 * overwrites a confirmed edited week (generate with confirmEdited, apply with any confirmed week) → Tier B; everything
 * else is an operational act with no step-up (audited). SQL sees only the confirmation flag, never a password.
 * Approve and apply post IDENTITIES (the week, the expected head, the preview token), never values: the server
 * re-derives everything. Every refusal is a named code with its status. No email, no notification.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/schedule");
  if (ctx instanceof Response) return ctx;
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "bad_request");
  const b = body as Record<string, unknown>;
  if (!exactShape(SCHEDULE_ACTIONS, b) || !isStr(b.locationId)) return jsonError(400, "bad_request");

  // The tier, before the lib (J12).
  const confirmed = b.action === "apply" && Array.isArray(b.confirmedWeekStarts) ? b.confirmedWeekStarts.length
    : b.action === "generate" && b.confirmEdited === true ? 1 : 0;
  const tier = b.action === "approve" ? stepUpFor("approve", { confirmedEditedWeeks: 0 })
    : b.action === "apply" || b.action === "generate" ? stepUpFor("regenerate", { confirmedEditedWeeks: confirmed }) : null;
  if (tier === "B") {
    const s = assertStepUp(ctx, "B");
    if (!s.ok) return jsonError(403, s.code);
  }

  const actor = peopleActorFromAuth(ctx);
  const deps = { service: getServiceRoleClient() };
  const locationId = b.locationId;
  try {
    switch (b.action) {
      case "generate":
        if (!isStr(b.weekStart) || !strOrNull(b.expectedHead) || typeof b.confirmEdited !== "boolean") return jsonError(400, "bad_request");
        return jsonOk({ result: await generateWeek(deps, { actor, locationId, weekStart: b.weekStart, expectedHead: b.expectedHead as string | null, confirmEdited: b.confirmEdited }) });
      case "preview":
        if (!b.request || typeof b.request !== "object") return jsonError(400, "bad_request");
        return jsonOk({ preview: await previewHorizon(deps, { actor, locationId, request: b.request as HorizonRequest }) });
      case "apply":
        if (!b.request || typeof b.request !== "object" || !isStr(b.token) || !Array.isArray(b.confirmedWeekStarts) || !b.confirmedWeekStarts.every(isStr)) return jsonError(400, "bad_request");
        return jsonOk({ result: await applyHorizon(deps, { actor, locationId, request: b.request as HorizonRequest, token: b.token, confirmedWeekStarts: b.confirmedWeekStarts as string[] }) });
      case "edit":
        if (!isStr(b.weekStart) || !isStr(b.expectedHead) || !b.op || typeof b.op !== "object") return jsonError(400, "bad_request");
        return jsonOk({ result: await saveEdit(deps, { actor, locationId, weekStart: b.weekStart, expectedHead: b.expectedHead, op: b.op as EditOp }) });
      case "approve":
        if (!isStr(b.weekStart) || !isStr(b.expectedHead)) return jsonError(400, "bad_request");
        return jsonOk({ result: await approveWeek(deps, { actor, locationId, weekStart: b.weekStart, expectedHead: b.expectedHead }) });
      case "budget":
        if ((b.scope !== "week" && b.scope !== "month") || !strOrNull(b.weekStart) || !strOrNull(b.month) || typeof b.hours !== "number") return jsonError(400, "bad_request");
        return jsonOk({ result: await setBudget(deps, { actor, locationId, scope: b.scope, weekStart: b.weekStart as string | null, month: b.month as string | null, hours: b.hours }) });
      case "accept_budget":
      case "keep_budget": {
        if (!isStr(b.weekStart) || !isStr(b.digest)) return jsonError(400, "bad_request");
        const a = { actor, locationId, weekStart: b.weekStart, digest: b.digest };
        return jsonOk({ result: b.action === "accept_budget" ? await acceptBudgetSuggestion(deps, a) : await keepBudget(deps, a) });
      }
      case "day_type":
        if (!isStr(b.date) || !["auto", "slow", "normal", "busy"].includes(b.dayType as string)) return jsonError(400, "bad_request");
        return jsonOk({ result: await setDayType(deps, { actor, locationId, date: b.date, dayType: b.dayType as "auto" | "slow" | "normal" | "busy" }) });
      case "pin":
        if (!b.pin || typeof b.pin !== "object") return jsonError(400, "bad_request");
        return jsonOk({ result: await setPin(deps, { actor, locationId, pin: b.pin as Parameters<typeof setPin>[1]["pin"] }) });
      case "person":
        if (!b.settings || typeof b.settings !== "object") return jsonError(400, "bad_request");
        return jsonOk({ result: await recordPersonSettings(deps, { actor, locationId, settings: b.settings as PersonSettingsInput }) });
      default:
        return jsonError(400, "bad_request");
    }
  } catch (error) {
    if (error instanceof ScheduleError) return jsonError(scheduleErrorStatus(error.code), error.code, { ...(error.key ? { key: error.key } : {}), params: error.params });
    return jsonError(500, "internal_error");
  }
}
