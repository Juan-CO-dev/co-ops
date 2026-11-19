/**
 * Item 21 PR 3 — the LINK step's server side (migration 0347). Read with docs/runbooks/catering-toast.md.
 *
 *  - loadHouseToastPanelFor: a house lead's current Toast links and candidate checks. The catering read gate first;
 *    null (nothing to show) when the shop is off, 0344 is not installed, or the lead is not a booked house lead.
 *    With 0344 but WITHOUT 0347 every read below still succeeds (they are all 0344 objects), so the loader asks
 *    0347's own probe, `catering_toast_link_ready` (linkStepReady): not ready = the panel is returned read-only with
 *    `linkStep: "not_installed"`, never a Link / No-ring control whose every click would fail (review PORTAL3-r1).
 *    Ownership shown is the database's effective owner (0347's planner + `catering_toast_ended_links`).
 *  - decideCateringToastLink: one decision through `decide_catering_toast`, the ONE writer of house links and decisions.
 *    The actor and the shop are bound here BEFORE the call (Juan answer 8); the function re-checks both under the
 *    reconcile lock, refuses a shop that is off, and writes the audit row in the same transaction. Never write
 *    catering_toast_links or catering_toast_link_decisions any other way.
 */
import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { canReadCateringLead, loadCateringReader } from "./ezcater-detail";
import { CateringPipelineError } from "./pipeline";
import { CateringToastNotInstalled, NOT_INSTALLED, raise, readPlanToCompletion, shopSettings } from "./catering-toast";
import {
  buildHouseToastPanel, canDecideCateringToast, TOAST_DECISION_ERRORS,
  type HouseToastPanel, type LinkStepState, type ToastDecisionHead, type ToastDecisionInput, type ToastEndedRow, type ToastLinkRow,
} from "./catering-toast-links-shared";
import type { HouseStatusRow } from "./catering-toast-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;

async function leadLocation(sb: Sb, leadId: string): Promise<string | null> {
  const { data, error } = await sb.from("catering_pipeline").select("location_id").eq("id", leadId)
    .maybeSingle<{ location_id: string | null }>();
  if (error) throw new CateringPipelineError(503, "catering_toast_unavailable");
  if (!data) throw new CateringPipelineError(404, "not_found");
  return data.location_id;
}

/**
 * Is the LINK STEP (migration 0347) installed? Asked of 0347's own probe, never inferred: with 0344 alone every panel
 * read succeeds. A missing function is `not_installed`; an answer other than `true` (a guard dropped or disabled) is
 * `not_installed` too; any other error throws (the panel is unavailable, never silently actionable).
 */
export async function linkStepReady(sb: Sb): Promise<LinkStepState> {
  const { data, error } = await sb.rpc("catering_toast_link_ready");
  if (error) {
    if (error.code && NOT_INSTALLED.has(error.code)) return "not_installed";
    throw new Error("catering_toast_read_failed");
  }
  return data === true ? "ready" : "not_installed";
}

type Pair = { location_id: string; order_guid: string; check_guid: string };
type CheckNow = { total_cents: number | null; business_date: string | null; live: boolean };

/** The lead's current links with their checks as Toast has them now (`live` false = voided, removed or recaptured away). */
async function currentLinks(sb: Sb, leadId: string): Promise<ToastLinkRow[]> {
  const links = await selectAllRows<{ location_id: string; order_guid: string; check_guid: string; evidence: ToastLinkRow["evidence"] }>(async (from, to) => {
    const res = await sb.from("catering_toast_links").select("location_id,order_guid,check_guid,evidence")
      .eq("lead_id", leadId).eq("is_current", true).order("id").range(from, to);
    if (res.error) raise(res.error);
    return res;
  });
  return withChecksNow(sb, links);
}

/** Links of this lead the SYSTEM ended (moved shops, lost, became ezCater), each with who holds the check now (0347). */
async function endedLinks(sb: Sb, leadId: string): Promise<ToastEndedRow[]> {
  const rows = await selectAllRows<Omit<ToastEndedRow, keyof CheckNow>>(async (from, to) => {
    const res = await sb.rpc("catering_toast_ended_links", { p_lead_id: leadId })
      .order("location_id").order("order_guid").order("check_guid").range(from, to);
    if (res.error) raise(res.error);
    return res;
  });
  return withChecksNow(sb, rows);
}

async function withChecksNow<T extends Pair>(sb: Sb, links: readonly T[]): Promise<Array<T & CheckNow>> {
  if (links.length === 0) return [];
  const out: Array<T & CheckNow> = [];
  for (const locationId of new Set(links.map((l) => l.location_id))) {
    const guids = [...new Set(links.filter((l) => l.location_id === locationId).map((l) => l.order_guid))];
    const orders = await selectAllRows<{ id: string; order_guid: string; business_date: string; voided: boolean; deleted: boolean; excess_food: boolean }>(async (from, to) => {
      const res = await sb.from("toast_orders_latest").select("id,order_guid,business_date,voided,deleted,excess_food")
        .eq("location_id", locationId).in("order_guid", guids).order("id").range(from, to);
      if (res.error) raise(res.error);
      return res;
    });
    const checks = orders.length === 0 ? [] : await selectAllRows<{ snapshot_id: string; check_guid: string; total_cents: number | null; voided: boolean; deleted: boolean }>(async (from, to) => {
      const res = await sb.from("toast_order_checks").select("snapshot_id,check_guid,total_cents,voided,deleted")
        .in("snapshot_id", orders.map((o) => o.id)).order("snapshot_id").order("check_guid").range(from, to);
      if (res.error) raise(res.error);
      return res;
    });
    for (const l of links.filter((x) => x.location_id === locationId)) {
      const order = orders.find((o) => o.order_guid === l.order_guid);
      const check = order ? checks.find((c) => c.snapshot_id === order.id && c.check_guid === l.check_guid) : undefined;
      const live = Boolean(order && check && !order.voided && !order.deleted && !order.excess_food && !check.voided && !check.deleted);
      out.push({ ...l, total_cents: check?.total_cents ?? null, business_date: order?.business_date ?? null, live });
    }
  }
  return out;
}

export async function loadHouseToastPanelFor(actor: AuthContext, leadId: string): Promise<HouseToastPanel | null> {
  const sb = getServiceRoleClient();
  const locationId = await leadLocation(sb, leadId);
  if (!await canReadCateringLead(actor, locationId)) throw new CateringPipelineError(403, "forbidden");
  if (!locationId) return null;
  const reader = await loadCateringReader(actor);
  try {
    if (!await shopSettings(sb, locationId)) return null;
    const { data: status, error } = await sb.from("catering_reconciliation_status")
      .select("lead_id,location_id,event_date,ring_code,value_cents,status").eq("lead_id", leadId)
      .maybeSingle<Pick<HouseStatusRow, "lead_id" | "location_id" | "event_date" | "ring_code" | "value_cents" | "status">>();
    if (error) raise(error);
    if (!status || status.location_id !== locationId) return null;
    const heads = await selectAllRows<ToastDecisionHead>(async (from, to) => {
      const res = await sb.from("catering_toast_decision_heads").select("id,kind,location_id,order_guid,check_guid,reason_code")
        .eq("lead_id", leadId).order("id").range(from, to);
      if (res.error) raise(res.error);
      return res;
    });
    const links = await currentLinks(sb, leadId);
    const plan = await readPlanToCompletion(sb, { p_location_id: locationId, p_from: status.event_date, p_to: status.event_date, p_note_codes: [] });
    // The named readiness check (review PORTAL3-r1): 0344 alone answers every read above.
    const linkStep = await linkStepReady(sb);
    const ended = linkStep === "ready" ? await endedLinks(sb, leadId) : [];
    return buildHouseToastPanel({ status, plan, heads, links: links.filter((l) => l.location_id === locationId), ended, linkStep,
      canDecide: reader !== null && canDecideCateringToast(reader, locationId) });
  } catch (error) {
    if (error instanceof CateringToastNotInstalled) return null;
    if (error instanceof CateringPipelineError) throw error;
    throw new CateringPipelineError(503, "catering_toast_unavailable");
  }
}

export interface ToastDecisionResult { decisionId: string; kind: ToastDecisionInput["kind"]; linkId?: string }

/** The function's own refusals pass through by name; anything else is a failure, never a silent success. */
const SQL_REFUSAL_STATUS: Partial<Record<(typeof TOAST_DECISION_ERRORS)[number], number>> = {
  forbidden: 403, invalid_decision: 400, catering_toast_off: 409,
};

export async function decideCateringToastLink(actor: AuthContext, leadId: string, input: ToastDecisionInput): Promise<ToastDecisionResult> {
  const reader = await loadCateringReader(actor);
  if (!reader?.active) throw new CateringPipelineError(403, "forbidden");
  const sb = getServiceRoleClient();
  const locationId = await leadLocation(sb, leadId);
  // Juan answer 8, bound before any write: catering manager (any shop), GM at their own shop, level 8+ any shop.
  if (!canDecideCateringToast(reader, locationId)) throw new CateringPipelineError(403, "forbidden");
  const args = {
    p_actor_id: actor.user.id, p_lead_id: leadId, p_kind: input.kind, p_location_id: input.locationId,
    p_order_guid: input.orderGuid, p_check_guid: input.checkGuid, p_reason_code: input.reasonCode,
    p_expected_head_id: input.expectedHeadId,
  };
  // A deadlock aborts the whole transaction; only that code is safe to replay (the expected head guards the rest).
  let result = await sb.rpc("decide_catering_toast", args);
  for (let retry = 0; result.error?.code === "40P01" && retry < 2; retry++) {
    await new Promise((resolve) => setTimeout(resolve, 25 * (retry + 1)));
    result = await sb.rpc("decide_catering_toast", args);
  }
  const { data, error } = result;
  if (error) {
    if (["PGRST202", "42883", "42P01", "PGRST205"].includes(error.code ?? "")) throw new CateringPipelineError(503, "catering_toast_unavailable");
    if (error.code === "40P01" || error.code === "55P03") throw new CateringPipelineError(503, "catering_toast_retry");
    const code = (TOAST_DECISION_ERRORS as readonly string[]).find((c) => c === error.message);
    if (code) throw new CateringPipelineError(SQL_REFUSAL_STATUS[code as keyof typeof SQL_REFUSAL_STATUS] ?? 409, code);
    if (error.message === "lead_not_found") throw new CateringPipelineError(404, "not_found");
    throw new Error("catering_toast_decision_failed");
  }
  const out = data as { decision_id?: string; kind?: string; link_id?: string } | null;
  if (!out?.decision_id || out.kind !== input.kind) throw new Error("catering_toast_decision_failed");
  return { decisionId: out.decision_id, kind: input.kind, ...(out.link_id ? { linkId: out.link_id } : {}) };
}
