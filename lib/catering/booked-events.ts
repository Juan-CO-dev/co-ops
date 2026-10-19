/**
 * BOOKED CATERING EVENTS — the one reader of "what catering is on the books for these dates" (Scheduling Phase 2,
 * Task 16; extracted from `loadCateringNight`, lib/report-digests-v2.ts, which now calls it — same query, same rows).
 *
 * `catering_pipeline` rows at the shop on the given event dates in the booked stages (confirmed / out / completed),
 * each valued at the latest ACCEPTED live quote's total, else `estimated_revenue_cents`. Service role, paged, the quote
 * read chunked. Scheduling NAMES these events (the catering prep rule, the budget reason); it never sums them into
 * sales (the Toast baseline already holds Toast-rung catering checks).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRows } from "@/lib/supabase-paginate";

export const BOOKED_STAGES = ["confirmed", "out", "completed"] as const;

export interface BookedCateringEvent {
  id: string;
  contactName: string;
  company: string | null;
  eventDate: string;
  timeWindow: string | null;
  headcount: number | null;
  stage: string;
  deliveryAddress: string | null;
  estimatedRevenueCents: number | null;
  /** The latest accepted live quote, when there is one. */
  acceptedQuote: { totalCents: number; isDelivery: boolean; version: number } | null;
  /** The accepted quote's total, else the estimate, else 0. */
  valueCents: number;
}

type Row = {
  id: string; contact_name: string; company: string | null; event_date: string; time_window: string | null; headcount: number | null; stage: string;
  delivery_address: string | null; estimated_revenue_cents: number | null;
};

export async function loadBookedCateringEvents(sb: SupabaseClient, args: { locationId: string; dates: readonly string[] }): Promise<BookedCateringEvent[]> {
  if (args.dates.length === 0) return [];
  const leads = await selectAllRows<Row>((from, to) =>
    sb.from("catering_pipeline").select("id, contact_name, company, event_date, time_window, headcount, stage, delivery_address, estimated_revenue_cents")
      .eq("location_id", args.locationId).in("event_date", [...args.dates]).in("stage", [...BOOKED_STAGES]).order("id").range(from, to));
  const ids = leads.map((l) => l.id);
  const quotes: Array<{ pipeline_id: string; total_cents: number; is_delivery: boolean; version: number }> = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    quotes.push(...await selectAllRows<{ pipeline_id: string; total_cents: number; is_delivery: boolean; version: number }>((from, to) =>
      sb.from("catering_quotes").select("pipeline_id, total_cents, is_delivery, version").in("pipeline_id", chunk)
        .eq("status", "accepted").is("superseded_at", null).order("id").range(from, to)));
  }
  const accepted = new Map<string, { total_cents: number; is_delivery: boolean; version: number }>();
  for (const q of quotes) { const p = accepted.get(q.pipeline_id); if (!p || q.version > p.version) accepted.set(q.pipeline_id, q); }
  return leads.map((l) => {
    const q = accepted.get(l.id) ?? null;
    return {
      id: l.id, contactName: l.contact_name, company: l.company, eventDate: l.event_date, timeWindow: l.time_window, headcount: l.headcount, stage: l.stage,
      deliveryAddress: l.delivery_address, estimatedRevenueCents: l.estimated_revenue_cents,
      acceptedQuote: q ? { totalCents: q.total_cents, isDelivery: q.is_delivery, version: q.version } : null,
      valueCents: q?.total_cents ?? l.estimated_revenue_cents ?? 0,
    };
  });
}
