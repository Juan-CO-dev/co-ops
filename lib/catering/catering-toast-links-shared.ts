/**
 * Item 21 PR 3 — the pure rules of the LINK step (migration 0347). Read with docs/runbooks/catering-toast.md.
 *
 *  - WHO: the catering manager (any shop) and GM and up (Juan answer 8): a GM at a shop they are an active member of,
 *    level 8+ at any shop. `canDecideCateringToast` is the app's copy; `decide_catering_toast` re-checks it in SQL under
 *    the locks. Nobody else sees a decision control.
 *  - WHAT: five decisions, the database's own vocabulary. A pair decision (link / unlink / not_a_match) names the
 *    logical Toast check (shop, order guid, check guid); a lead decision (no_ring_expected / ring_expected) names none.
 *    Every request carries the head the person SAW for that key (`expectedHeadId`, null = none): another decision since
 *    is `decision_moved`, never a blind overwrite.
 *  - REFUSALS are named, each with an en + es message (`decisionErrorKey`); an unknown code is generic.
 *  - THE PANEL lists a lead's current links and its candidate checks from the house planner, each with the state that
 *    decides what a person may do with it. A suggestion never links anything: only "Link this check" does.
 * Zero I/O. Client-safe.
 */
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import { compareToastCandidates, type CateringToastPlanRow, type ToastEvidence } from "./catering-toast-shared";

export const TOAST_DECISION_KINDS = ["link", "unlink", "not_a_match", "no_ring_expected", "ring_expected"] as const;
export type ToastDecisionKind = (typeof TOAST_DECISION_KINDS)[number];
export const TOAST_PAIR_KINDS: readonly ToastDecisionKind[] = ["link", "unlink", "not_a_match"];
/** 0344's closed reason list for no_ring_expected (no free text anywhere in a decision). */
export const TOAST_NO_RING_REASONS = ["paid_outside_toast", "cancelled", "comped", "duplicate_lead", "other"] as const;
export type ToastNoRingReason = (typeof TOAST_NO_RING_REASONS)[number];

/** Every refusal decide_catering_toast and the route name. */
export const TOAST_DECISION_ERRORS = [
  "forbidden", "not_found", "invalid_decision", "lead_not_eligible", "lead_moved", "decision_moved", "check_not_found",
  "check_out_of_window", "check_owned_by_ezcater", "check_owned_by_house", "already_linked", "not_linked",
  "linked_use_unlink", "already_decided", "lead_has_links", "lead_no_ring_expected", "not_marked", "catering_toast_off",
  "catering_toast_unavailable", "catering_toast_retry",
] as const;
export type ToastDecisionError = (typeof TOAST_DECISION_ERRORS)[number];
export function decisionErrorKey(code: string): `catering.toast_link.error.${string}` {
  return (TOAST_DECISION_ERRORS as readonly string[]).includes(code)
    ? `catering.toast_link.error.${code}` : "catering.toast_link.error.generic";
}

/** Juan answer 8. The SQL twin is decide_catering_toast's actor check. */
export function canDecideCateringToast(actor: { role: RoleCode; active: boolean; locations: readonly string[] }, leadLocationId: string | null): boolean {
  if (!actor.active || !leadLocationId) return false;
  if (actor.role === "catering_mgr" || getRoleLevel(actor.role) >= 8) return true;
  return actor.role === "gm" && actor.locations.includes(leadLocationId);
}

export interface ToastDecisionInput {
  kind: ToastDecisionKind;
  locationId: string | null; orderGuid: string | null; checkGuid: string | null;
  reasonCode: ToastNoRingReason | null;
  expectedHeadId: string | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guid = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 200;

/** The request body, or null. Exactly the keys the kind needs; `expectedHeadId` is required (null or a uuid). */
export function parseToastDecision(raw: unknown): ToastDecisionInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (!(TOAST_DECISION_KINDS as readonly unknown[]).includes(b.kind)) return null;
  const kind = b.kind as ToastDecisionKind;
  if (!("expectedHeadId" in b) || !(b.expectedHeadId === null || (typeof b.expectedHeadId === "string" && UUID.test(b.expectedHeadId)))) return null;
  const pair = TOAST_PAIR_KINDS.includes(kind);
  if (pair) {
    if (typeof b.locationId !== "string" || !UUID.test(b.locationId) || !guid(b.orderGuid) || !guid(b.checkGuid)) return null;
  } else if (b.locationId !== undefined || b.orderGuid !== undefined || b.checkGuid !== undefined) return null;
  if (kind === "no_ring_expected") {
    if (!(TOAST_NO_RING_REASONS as readonly unknown[]).includes(b.reasonCode)) return null;
  } else if (b.reasonCode !== undefined && b.reasonCode !== null) return null;
  return {
    kind,
    locationId: pair ? (b.locationId as string).toLowerCase() : null,
    orderGuid: pair ? b.orderGuid as string : null,
    checkGuid: pair ? b.checkGuid as string : null,
    reasonCode: kind === "no_ring_expected" ? b.reasonCode as ToastNoRingReason : null,
    expectedHeadId: b.expectedHeadId === null ? null : (b.expectedHeadId as string).toLowerCase(),
  };
}

/** A row of `catering_toast_decision_heads` (0344). */
export interface ToastDecisionHead {
  id: string; kind: ToastDecisionKind; location_id: string | null; order_guid: string | null; check_guid: string | null;
  reason_code: ToastNoRingReason | null;
}
/** A current link of the lead, with its check as Toast has it now (`live` false = the check is gone or voided). */
export interface ToastLinkRow {
  location_id: string; order_guid: string; check_guid: string; evidence: "manual" | "ring_code" | "toast_origin";
  total_cents: number | null; business_date: string | null; live: boolean;
}

export type CandidateState = "open" | "dual_code" | "owned_ezcater" | "owned_house" | "blocked";
const STATE_ORDER: readonly CandidateState[] = ["open", "dual_code", "owned_ezcater", "owned_house", "blocked"];

export interface ToastCandidate {
  orderGuid: string; checkGuid: string; businessDate: string; evidence: ToastEvidence;
  checkTotalCents: number | null; amountDiffCents: number | null; amountMismatch: boolean;
  state: CandidateState; blockedBy: "unlink" | "not_a_match" | null; headId: string | null;
}
export interface ToastLinkView {
  locationId: string; orderGuid: string; checkGuid: string; evidence: ToastLinkRow["evidence"];
  totalCents: number | null; businessDate: string | null; live: boolean; headId: string | null;
}
export interface HouseToastPanel {
  leadId: string; locationId: string; eventDate: string; ringCode: string | null; valueCents: number | null;
  status: "matched" | "amount_mismatch" | "not_rung_in_toast" | "no_ring_expected";
  canDecide: boolean;
  leadHead: { id: string; kind: ToastDecisionKind; reasonCode: ToastNoRingReason | null } | null;
  links: ToastLinkView[];
  candidates: ToastCandidate[];
}

const pairKey = (loc: string | null, order: string | null, check: string | null) => `${loc}|${order}|${check}`;
const num = (v: number | string | null) => (v === null ? null : Number(v));

/** The panel from one status row, the planner rows of its window, the lead's decision heads and its current links. */
export function buildHouseToastPanel(args: {
  status: { lead_id: string; location_id: string; event_date: string; ring_code: string | null; value_cents: number | null; status: HouseToastPanel["status"] };
  plan: readonly CateringToastPlanRow[]; heads: readonly ToastDecisionHead[]; links: readonly ToastLinkRow[]; canDecide: boolean;
}): HouseToastPanel {
  const { status } = args;
  const headByPair = new Map(args.heads.filter((h) => h.location_id !== null).map((h) => [pairKey(h.location_id, h.order_guid, h.check_guid), h]));
  const lead = args.heads.find((h) => h.location_id === null) ?? null;
  const linked = new Set(args.links.map((l) => pairKey(l.location_id, l.order_guid, l.check_guid)));
  const stateOf = (r: CateringToastPlanRow): CandidateState => r.blocked ? "blocked"
    : r.owner === "ezcater" ? "owned_ezcater" : r.owner === "house" ? "owned_house" : r.dual_code ? "dual_code" : "open";
  const rows = args.plan.filter((r) => r.lead_id === status.lead_id && !linked.has(pairKey(r.location_id, r.order_guid, r.check_guid)));
  rows.sort((a, b) => STATE_ORDER.indexOf(stateOf(a)) - STATE_ORDER.indexOf(stateOf(b)) || compareToastCandidates(a, b));
  return {
    leadId: status.lead_id, locationId: status.location_id, eventDate: status.event_date, ringCode: status.ring_code,
    valueCents: num(status.value_cents), status: status.status, canDecide: args.canDecide,
    leadHead: lead ? { id: lead.id, kind: lead.kind, reasonCode: lead.reason_code } : null,
    links: args.links.map((l) => ({
      locationId: l.location_id, orderGuid: l.order_guid, checkGuid: l.check_guid, evidence: l.evidence,
      totalCents: num(l.total_cents), businessDate: l.business_date, live: l.live,
      headId: headByPair.get(pairKey(l.location_id, l.order_guid, l.check_guid))?.id ?? null,
    })),
    candidates: rows.map((r) => {
      const head = headByPair.get(pairKey(r.location_id, r.order_guid, r.check_guid)) ?? null;
      const state = stateOf(r);
      return {
        orderGuid: r.order_guid, checkGuid: r.check_guid, businessDate: r.business_date, evidence: r.evidence,
        checkTotalCents: num(r.check_total_cents), amountDiffCents: num(r.amount_diff_cents), amountMismatch: r.amount_mismatch,
        state, blockedBy: state === "blocked" && (head?.kind === "unlink" || head?.kind === "not_a_match") ? head.kind : null,
        headId: head?.id ?? null,
      };
    }),
  };
}

/** What a person may do with a candidate. A dual-code check is linkable: the human decides (plan r3 #4). */
export function candidateActions(c: ToastCandidate): Array<"link" | "not_a_match"> {
  if (c.state === "open" || c.state === "dual_code") return ["link", "not_a_match"];
  if (c.state === "blocked") return ["link"];
  return [];
}
