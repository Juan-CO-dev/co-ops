/**
 * Item 21 PR 5 — MATCHING THE OLD ORDERS (Juan answer 7: "backfill old orders as suggestions"). Pure rules.
 *
 * Nothing automatic reaches an old order. A person reviews the orders that are not matched yet and confirms, in one
 * step, the checks the system is SURE about; each confirmed check is an ordinary human link through the one writer
 * (`decide_catering_toast`: its own decision row, its own audit row, the same refusals). What "sure" means here:
 *   - the evidence is strong: the check is on the order's own Toast order (`toast_origin`) or carries its ring code;
 *     an amount-and-date suggestion is never swept up (a person looks at those one by one in the order's panel);
 *   - the pair is linkable by the writer's own rule (`linkRefusal`: inside the day-before to a-week-after window,
 *     nobody holds the check);
 *   - nobody said no (an unlink / not-a-match tombstone), the check does not also carry an ezCater number, and no
 *     second order claims the same check.
 * Everything else is counted by reason so the person knows why it was left for the panel.
 * Zero I/O. Client-safe.
 */
import { linkRefusal } from "./catering-toast-links-shared";
import type { CateringToastPlanRow, HouseStatusRow } from "./catering-toast-shared";

export interface OldOrderMatch {
  leadId: string; eventDate: string; valueCents: number | null;
  orderGuid: string; checkGuid: string; businessDate: string; checkTotalCents: number | null;
  evidence: "toast_origin" | "ring_code"; amountMismatch: boolean;
  /** The pair's decision head the server read (null = none): the writer refuses if someone decided since. */
  expectedHeadId: string | null;
}
export const OLD_ORDER_SKIPS = ["blocked", "owned", "dual_code", "out_of_window", "two_orders"] as const;
export type OldOrderSkip = (typeof OLD_ORDER_SKIPS)[number];
export interface OldOrderMatches {
  /** House orders at the shop that are not matched to a Toast check yet (through today). */
  orders: number;
  /** Of those, the orders with at least one check to confirm. */
  ordersMatched: number;
  matches: OldOrderMatch[];
  /** Strong candidates left for the panel, by reason (checks, not orders). */
  skipped: Record<OldOrderSkip, number>;
}
export interface PairHead { id: string; lead_id: string; kind: string; location_id: string | null; order_guid: string | null; check_guid: string | null }

const pair = (orderGuid: string, checkGuid: string) => JSON.stringify([orderGuid, checkGuid]);

export function oldOrderMatches(args: { status: readonly HouseStatusRow[]; plan: readonly CateringToastPlanRow[]; heads: readonly PairHead[] }): OldOrderMatches {
  const leads = new Map(args.status.filter((s) => s.status === "not_rung_in_toast").map((s) => [s.lead_id, s]));
  const strong = args.plan.filter((p) => leads.has(p.lead_id) && (p.evidence === "toast_origin" || p.evidence === "ring_code"));
  const claims = new Map<string, Set<string>>();
  for (const p of strong) claims.set(pair(p.order_guid, p.check_guid), new Set([...(claims.get(pair(p.order_guid, p.check_guid)) ?? []), p.lead_id]));
  const headOf = new Map(args.heads.filter((h) => h.order_guid !== null && h.check_guid !== null)
    .map((h) => [JSON.stringify([h.lead_id, h.order_guid, h.check_guid]), h.id]));
  const skipped: Record<OldOrderSkip, number> = { blocked: 0, owned: 0, dual_code: 0, out_of_window: 0, two_orders: 0 };
  const matches: OldOrderMatch[] = [];
  for (const p of strong) {
    const lead = leads.get(p.lead_id)!;
    const refusal = linkRefusal({ eventDate: lead.event_date, leadHead: null }, { live: true, businessDate: p.business_date, owner: p.owner });
    const skip: OldOrderSkip | null = p.blocked ? "blocked"
      : refusal === "check_owned_by_ezcater" || refusal === "check_owned_by_house" ? "owned"
      : refusal !== null ? "out_of_window"
      : p.dual_code ? "dual_code"
      : (claims.get(pair(p.order_guid, p.check_guid))?.size ?? 0) > 1 ? "two_orders" : null;
    if (skip) { skipped[skip] += 1; continue; }
    matches.push({
      leadId: p.lead_id, eventDate: lead.event_date, valueCents: lead.value_cents === null ? null : Number(lead.value_cents),
      orderGuid: p.order_guid, checkGuid: p.check_guid, businessDate: p.business_date,
      checkTotalCents: p.check_total_cents === null ? null : Number(p.check_total_cents),
      evidence: p.evidence as "toast_origin" | "ring_code", amountMismatch: p.amount_mismatch,
      expectedHeadId: headOf.get(JSON.stringify([p.lead_id, p.order_guid, p.check_guid])) ?? null,
    });
  }
  matches.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.leadId.localeCompare(b.leadId) || a.orderGuid.localeCompare(b.orderGuid) || a.checkGuid.localeCompare(b.checkGuid));
  return { orders: leads.size, ordersMatched: new Set(matches.map((m) => m.leadId)).size, matches, skipped };
}

/** What the card shows before a person confirms: the counts and the first rows, never contact data (none exists here). */
export interface OldOrdersView {
  state: "ready" | "off" | "not_installed";
  orders: number; ordersMatched: number; checks: number;
  skipped: Record<OldOrderSkip, number>;
  sample: Array<Pick<OldOrderMatch, "leadId" | "eventDate" | "valueCents" | "businessDate" | "checkTotalCents" | "evidence" | "amountMismatch" | "checkGuid">>;
}
export const OLD_ORDERS_SAMPLE = 10;
export const EMPTY_OLD_ORDERS = (state: OldOrdersView["state"]): OldOrdersView =>
  ({ state, orders: 0, ordersMatched: 0, checks: 0, skipped: { blocked: 0, owned: 0, dual_code: 0, out_of_window: 0, two_orders: 0 }, sample: [] });
export function oldOrdersView(m: OldOrderMatches): OldOrdersView {
  return { state: "ready", orders: m.orders, ordersMatched: m.ordersMatched, checks: m.matches.length, skipped: m.skipped,
    sample: m.matches.slice(0, OLD_ORDERS_SAMPLE).map(({ leadId, eventDate, valueCents, businessDate, checkTotalCents, evidence, amountMismatch, checkGuid }) =>
      ({ leadId, eventDate, valueCents, businessDate, checkTotalCents, evidence, amountMismatch, checkGuid })) };
}

/** One batch of confirmed links. `remaining` > 0 = there is more (the client continues by itself while it makes progress). */
export interface OldOrdersLinkResult { linked: number; refused: Record<string, number>; remaining: number }
export const OLD_ORDERS_BATCH = 60;
export const OLD_ORDERS_MAX_SKIP = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Strict: exactly `locationId` and `skip`. The server recomputes what to link on every batch; a client never sends
 * the list. `skip` = how many checks the writer REFUSED in the batches before this one: a refused pair stays in the
 * recomputed list (sorted first, the linked ones have left it), so the next batch starts after them instead of
 * asking the writer the same question again.
 */
export function parseOldOrdersLink(raw: unknown): { locationId: string; skip: number } | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || typeof body.locationId !== "string" || !UUID.test(body.locationId)) return null;
  if (typeof body.skip !== "number" || !Number.isInteger(body.skip) || body.skip < 0 || body.skip > OLD_ORDERS_MAX_SKIP) return null;
  return { locationId: body.locationId.toLowerCase(), skip: body.skip };
}
