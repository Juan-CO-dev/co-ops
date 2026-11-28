/**
 * Catering refunds Part B1 v2: the inventory read (plan 4.2, DR9; the sign-off page `/admin/catering/refunds`).
 * Server-only. ONE call: migration 0359 F15 `catering_refund_inventory()` with the service client; nothing else is
 * read, nothing is written, Stripe is never called. Its answer is ids, cents, states, reasons and instants only (no
 * customer or staff data), mapped here to a typed model. A missing schema (0359 not applied) is `not_installed`;
 * any other error is thrown (the page shows it as unavailable, never as an empty inventory).
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { refundSchemaMissing } from "@/lib/catering/refund-observe";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

export interface RefundInventoryObservation {
  observeOn: boolean;
  transitions: number | null;
  transitionedAt: string | null;
  resumedAt: string | null;
  live: boolean;
  lastClaimAt: string | null;
  lastPassEndedAt: string | null;
  lastPassReads: number | null;
  lastPassComplete: number | null;
  /** The last finished pass ended at or after the last claim (F15). */
  lastPassIsOfLastClaim: boolean;
  /** [T6] the warning: there is a claim and no finished pass of it. */
  claimNewerThanPass: boolean;
}

export const REFUND_INVENTORY_COUNTS = [
  "in_scope", "paused", "never_read", "dirty", "known", "not_complete", "open_reads", "abandoned_reads", "disagreements",
  "unresolved_requests", "unconfirmed", "legacy_attempted", "attachable", "released_with_refund", "unbound_claims",
] as const;
export type RefundInventoryCount = (typeof REFUND_INVENTORY_COUNTS)[number];

export interface RefundInventory {
  generatedAt: string | null;
  observation: RefundInventoryObservation;
  counts: Record<RefundInventoryCount, number>;
  unsettledCheckouts: number;
  claimsByKind: Record<string, number>;
  notCompleteByReason: Record<string, number>;
  lists: {
    notComplete: Array<{ paymentId: string; reason: string | null; conflictWith: string | null; attemptedAt: string | null }>;
    neverRead: string[];
    dirty: string[];
    openReads: Array<{ paymentId: string; startedAt: string | null; abandoned: boolean }>;
    disagreements: Array<{ paymentId: string; status: string | null; capturedCents: number | null; countedCents: number | null; stripeWhole: boolean | null }>;
    unresolvedRequests: Array<{
      requestId: string; paymentId: string; amountCents: number | null; armed: boolean; armedAt: string | null;
      releasableAt: string | null; requestedAt: string | null; legacy: boolean; lastErrorCode: string | null;
    }>;
    claims: Array<{ refundId: string; paymentId: string; kind: string | null; amountCents: number | null; status: string | null; attachableTo: string | null }>;
    unsettledCheckouts: Array<{ paymentId: string; status: string | null }>;
  };
  oldestUncheckedAt: string | null;
  oldestReadStartedAt: string | null;
}

export type RefundInventoryResult = { state: "ready"; inventory: RefundInventory } | { state: "not_installed" };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
};
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const numMap = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, num(n) ?? 0]));

/** F15's JSON → the typed model (pure; exported for the test). Unknown or missing values read as their safe side. */
export function refundInventoryFromRpc(raw: unknown): RefundInventory {
  const root = obj(raw);
  const o = obj(root.observation);
  const c = obj(root.counts);
  const l = obj(root.lists);
  const lastClaimAt = str(o.last_claim_at);
  const lastPassEndedAt = str(o.last_pass_ended_at);
  const lastPassIsOfLastClaim = o.last_pass_is_of_last_claim === true;
  const counts = Object.fromEntries(REFUND_INVENTORY_COUNTS.map((k) => [k, num(c[k]) ?? 0])) as Record<RefundInventoryCount, number>;
  return {
    generatedAt: str(root.generated_at),
    observation: {
      observeOn: o.observe_on === true,
      transitions: num(o.transitions),
      transitionedAt: str(o.transitioned_at),
      resumedAt: str(o.resumed_at),
      live: o.live === true,
      lastClaimAt,
      lastPassEndedAt,
      lastPassReads: num(o.last_pass_reads),
      lastPassComplete: num(o.last_pass_complete),
      lastPassIsOfLastClaim,
      claimNewerThanPass: lastClaimAt !== null && !lastPassIsOfLastClaim,
    },
    counts,
    unsettledCheckouts: num(c.unsettled_checkouts) ?? 0,
    claimsByKind: numMap(c.claims),
    notCompleteByReason: numMap(root.not_complete_by_reason),
    lists: {
      notComplete: arr(l.not_complete).map(obj).map((x) => ({
        paymentId: String(x.payment_id ?? ""), reason: str(x.reason), conflictWith: str(x.conflict_with), attemptedAt: str(x.attempted_at),
      })),
      neverRead: arr(l.never_read).map((x) => String(x)),
      dirty: arr(l.dirty).map((x) => String(x)),
      openReads: arr(l.open_reads).map(obj).map((x) => ({ paymentId: String(x.payment_id ?? ""), startedAt: str(x.started_at), abandoned: x.abandoned === true })),
      disagreements: arr(l.disagreements).map(obj).map((x) => ({
        paymentId: String(x.payment_id ?? ""), status: str(x.status), capturedCents: num(x.captured_cents), countedCents: num(x.counted_cents), stripeWhole: boolOrNull(x.stripe_whole),
      })),
      unresolvedRequests: arr(l.unresolved_requests).map(obj).map((x) => ({
        requestId: String(x.request_id ?? ""), paymentId: String(x.payment_id ?? ""), amountCents: num(x.amount_cents), armed: x.armed === true,
        armedAt: str(x.armed_at), releasableAt: str(x.releasable_at), requestedAt: str(x.requested_at), legacy: x.legacy === true,
        lastErrorCode: str(x.last_error_code),
      })),
      claims: arr(l.claims).map(obj).map((x) => ({
        refundId: String(x.refund_id ?? ""), paymentId: String(x.payment_id ?? ""), kind: str(x.kind), amountCents: num(x.amount_cents),
        status: str(x.status), attachableTo: str(x.attachable_to),
      })),
      unsettledCheckouts: arr(l.unsettled_checkouts).map(obj).map((x) => ({ paymentId: String(x.payment_id ?? ""), status: str(x.status) })),
    },
    oldestUncheckedAt: str(root.oldest_unchecked_at),
    oldestReadStartedAt: str(root.oldest_read_started_at),
  };
}

/** The ONE read of the inventory page. `sb` is a parameter only so a test can hand in the PGlite stand-in. */
export async function loadRefundInventory(sb: ServiceClient = getServiceRoleClient()): Promise<RefundInventoryResult> {
  const { data, error } = await sb.rpc("catering_refund_inventory");
  if (error) {
    if (refundSchemaMissing(error)) return { state: "not_installed" };
    throw new Error(`catering_refund_inventory: ${error.code ?? "error"}`);
  }
  if (!data || typeof data !== "object") throw new Error("catering_refund_inventory: no answer");
  return { state: "ready", inventory: refundInventoryFromRpc(data) };
}
