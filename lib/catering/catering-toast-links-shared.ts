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
 *  - OWNERSHIP IS THE DATABASE'S (fix round 1): a candidate's `owner` is the planner's, and 0347's planner answers it
 *    from `catering_toast_house_owner`, the writer's own rule. A lead that was lost, moved or became ezCater owns
 *    nothing. A link the SYSTEM ended (the lead moved shops and came back, was lost and re-opened) is listed under
 *    `ended` with who holds the check NOW: the lead shows the conflict, it never owns the check again by itself.
 *  - A CHECK ANOTHER ORDER HOLDS CAN STILL BE DISMISSED (fix round 3, review PORTAL3-r3): "Not a match" is offered on a
 *    check ezCater or another house order holds, and on an ended link, so a manager can clear the conflict. It only
 *    tombstones THIS order's pair; ownership never moves. "Link" is never offered over an owner, tombstoned or not.
 *    Every reachable (lead x check x owner) state is a row of tests/fixtures/catering-toast-state-table.json.
 *  - THE LINK STEP MUST BE INSTALLED (`linkStep`): every object the panel reads exists since 0344, so the server asks
 *    0347's readiness probe. `not_installed` = no decision control at all, and the panel says why.
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

/** A link the system ended (0347 `catering_toast_ended_links`), with its check as Toast has it now. */
export const TOAST_ENDED_REASONS = ["lead_moved", "lead_lost", "lead_ezcater"] as const;
export type ToastEndedReason = (typeof TOAST_ENDED_REASONS)[number];
export interface ToastEndedRow {
  location_id: string; order_guid: string; check_guid: string; evidence: ToastLinkRow["evidence"];
  retired_reason: ToastEndedReason; head_id: string; owner: "ezcater" | "house" | null;
  total_cents: number | null; business_date: string | null; live: boolean;
}
/** Is migration 0347 (the writer and its guards) in place? Asked by name; never inferred from the reads working. */
export type LinkStepState = "ready" | "not_installed";

export type CandidateState = "open" | "dual_code" | "owned_ezcater" | "owned_house" | "blocked";
const STATE_ORDER: readonly CandidateState[] = ["open", "dual_code", "owned_ezcater", "owned_house", "blocked"];

export interface ToastCandidate {
  orderGuid: string; checkGuid: string; businessDate: string; evidence: ToastEvidence;
  checkTotalCents: number | null; amountDiffCents: number | null; amountMismatch: boolean;
  state: CandidateState; blockedBy: "unlink" | "not_a_match" | null; headId: string | null;
  /** Who holds the check now, whatever the state (a tombstoned pair keeps its owner). */
  owner: "ezcater" | "house" | null;
}
export interface ToastLinkView {
  locationId: string; orderGuid: string; checkGuid: string; evidence: ToastLinkRow["evidence"];
  totalCents: number | null; businessDate: string | null; live: boolean; headId: string | null;
}
export interface ToastEndedLink {
  orderGuid: string; checkGuid: string; evidence: ToastLinkRow["evidence"]; reason: ToastEndedReason;
  /** Who holds the check now. null = nobody: a person may link it again. */
  owner: "ezcater" | "house" | null;
  totalCents: number | null; businessDate: string | null; live: boolean; headId: string;
}
export interface HouseToastPanel {
  leadId: string; locationId: string; eventDate: string; ringCode: string | null; valueCents: number | null;
  status: "matched" | "amount_mismatch" | "not_rung_in_toast" | "no_ring_expected";
  linkStep: LinkStepState;
  /** May this viewer decide HERE and NOW: the role and shop rule AND the link step installed. */
  canDecide: boolean;
  ended: ToastEndedLink[];
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
  linkStep: LinkStepState; ended?: readonly ToastEndedRow[];
}): HouseToastPanel {
  const { status } = args;
  const headByPair = new Map(args.heads.filter((h) => h.location_id !== null).map((h) => [pairKey(h.location_id, h.order_guid, h.check_guid), h]));
  const lead = args.heads.find((h) => h.location_id === null) ?? null;
  const linked = new Set(args.links.map((l) => pairKey(l.location_id, l.order_guid, l.check_guid)));
  const stateOf = (r: CateringToastPlanRow): CandidateState => r.blocked ? "blocked"
    : r.owner === "ezcater" ? "owned_ezcater" : r.owner === "house" ? "owned_house" : r.dual_code ? "dual_code" : "open";
  // An ended link is shown once, under `ended`, with its present owner: never also as a fresh suggestion.
  const ended = (args.ended ?? []).filter((e) => e.location_id === status.location_id && !linked.has(pairKey(e.location_id, e.order_guid, e.check_guid)));
  const endedPairs = new Set(ended.map((e) => pairKey(e.location_id, e.order_guid, e.check_guid)));
  const rows = args.plan.filter((r) => r.lead_id === status.lead_id && !linked.has(pairKey(r.location_id, r.order_guid, r.check_guid))
    && !endedPairs.has(pairKey(r.location_id, r.order_guid, r.check_guid)));
  rows.sort((a, b) => STATE_ORDER.indexOf(stateOf(a)) - STATE_ORDER.indexOf(stateOf(b)) || compareToastCandidates(a, b));
  return {
    leadId: status.lead_id, locationId: status.location_id, eventDate: status.event_date, ringCode: status.ring_code,
    valueCents: num(status.value_cents), status: status.status, linkStep: args.linkStep,
    // No control without the writer: a click would only fail (review PORTAL3-r1).
    canDecide: args.canDecide && args.linkStep === "ready",
    ended: ended.map((e) => ({
      orderGuid: e.order_guid, checkGuid: e.check_guid, evidence: e.evidence, reason: e.retired_reason, owner: e.owner,
      totalCents: num(e.total_cents), businessDate: e.business_date, live: e.live, headId: e.head_id,
    })),
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
        headId: head?.id ?? null, owner: r.owner,
      };
    }),
  };
}

/** What a person may do with a candidate. A dual-code check is linkable: the human decides (plan r3 #4). A check
 * another order holds is never linkable, but "Not a match" stays: it is how a manager clears the conflict without
 * touching the owner. A tombstoned pair (blocked) offers Relink only while nobody holds the check. */
export function candidateActions(c: ToastCandidate): Array<"link" | "not_a_match"> {
  if (c.state === "open" || c.state === "dual_code") return ["link", "not_a_match"];
  if (c.state === "blocked") return c.owner === null ? ["link"] : [];
  return ["not_a_match"];
}
/** An ended link may be linked again only while nobody holds the check and it is still live in Toast. "Not a match"
 * dismisses it (the row leaves "Links that ended"; the pair becomes a tombstone), whoever holds the check. */
export function endedActions(e: ToastEndedLink): Array<"link" | "not_a_match"> {
  return e.owner === null && e.live ? ["link", "not_a_match"] : ["not_a_match"];
}
