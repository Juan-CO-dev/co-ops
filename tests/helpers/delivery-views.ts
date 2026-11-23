/**
 * Catering delivery D2: builders of the GET response (`LeadDeliveryView`, lib/delivery/jobs.ts) for the panel tests.
 * `write: false` builds what a status-only viewer receives: no `detail`, no `cost`.
 */
import type { LeadDeliveryView } from "@/lib/delivery/jobs";
import type { DeliveryCostRow, DeliveryJob, DeliveryJobEvent, DeliveryState, OrderQuoteKind } from "@/lib/delivery/types-shared";
import { orderCost } from "@/lib/delivery/cost-shared";

export const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b";
export const LEAD = "00000000-0000-4000-8000-0000000000d1";
type LeadView = Extract<LeadDeliveryView, { view: "lead" }>;

export function jobOf(o: Partial<DeliveryJob> = {}): DeliveryJob {
  return { id: "00000000-0000-4000-8000-0000000000e1", pipelineId: LEAD, locationId: B, quoteId: null, confirmEventId: null, bookedVia: "manual", providerLabel: "Courier A",
    externalRef: "REF-77", attemptNo: 1, pickupAt: "2026-11-25T15:40:00.000Z", dropoffAt: "2026-11-25T16:30:00.000Z", closedAt: null, createdBy: "u", createdAt: "2026-11-22T10:00:00Z",
    status: "accepted", statusSeq: 1, statusAt: "2026-11-22T15:00:00.000Z", ...o };
}
export function eventOf(job: DeliveryJob, o: Partial<DeliveryJobEvent> = {}): DeliveryJobEvent {
  return { id: `${job.id}-1`, jobId: job.id, seq: 1, status: "accepted", occurredAt: "2026-11-22T15:00:00.000Z", recordedAt: "2026-11-22T15:00:00.000Z", source: "manual", actorId: "u", note: null, ...o };
}

export function viewOf(o: {
  state: DeliveryState; enabled?: boolean; write?: boolean; money?: boolean; isEzcater?: boolean; shopId?: string | null;
  orderQuote?: { kind: OrderQuoteKind; isDelivery: boolean | null }; jobs?: DeliveryJob[]; events?: DeliveryJobEvent[]; costs?: DeliveryCostRow[]; providers?: string[];
}): LeadView {
  const jobs = o.jobs ?? [];
  const write = o.write ?? true;
  const about = [...jobs].sort((a, b) => b.attemptNo - a.attemptNo).find((j) => j.closedAt === null) ?? [...jobs].sort((a, b) => b.attemptNo - a.attemptNo)[0] ?? null;
  const view: LeadView = {
    view: "lead", leadId: LEAD, shopId: o.shopId === undefined ? B : o.shopId, enabled: o.enabled ?? true, isEzcater: o.isEzcater ?? false,
    orderQuote: o.orderQuote ?? { kind: "accepted", isDelivery: true }, state: o.state,
    status: about ? { attemptNo: about.attemptNo, status: about.status, statusAt: about.statusAt, providerLabel: about.providerLabel, pickupAt: about.pickupAt, dropoffAt: about.dropoffAt } : null,
  };
  if (write) view.detail = { jobs, events: o.events ?? jobs.map((j) => eventOf(j)), pickupDecisions: [], manualProviders: o.providers ?? ["Courier A"] };
  if (write && o.money !== false) {
    const costs = o.costs ?? [];
    view.cost = { costs, orderCost: orderCost(jobs.map((j) => ({ jobId: j.id, costs }))), splits: [], splitHead: null, candidates: [], gratuityDriverBps: 1000 };
  }
  return view;
}
