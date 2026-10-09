/**
 * Toast capture → customer profiles (server-only). 0234.
 *
 * Called by lib/toast/capture.ts ONLY after a full-day capture finished (the latest pointers exist),
 * with the raw orders that stayed in request memory. Off unless CUSTOMER_PROFILES=1. Never fails the
 * capture: a profile miss is retried by the next tick, which re-captures today.
 *
 * Identity is resolved in SQL (email, then phone). After linking, the pure name + card scorer files
 * "likely same person" suggestions for a manager; it never merges anything.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { customerProfilesEnabled } from "./customers";
import { channelLookup, extractCustomerRows } from "./extract-shared";
import { likelySamePerson } from "./identity-shared";
import { chunkRows } from "./consent-shared";

export interface CustomerCaptureResult { ok: boolean; linked: number; skipped: number; created: number; suggestions: number; error: string | null }

type Client = Pick<SupabaseClient, "rpc" | "from">;

export async function persistCapturedCustomers(locationId: string, rawOrders: readonly unknown[], options: { signal?: AbortSignal; client?: Client } = {}): Promise<CustomerCaptureResult> {
  const empty = { linked: 0, skipped: 0, created: 0, suggestions: 0 };
  if (!customerProfilesEnabled()) return { ok: true, ...empty, error: "customer_profiles_off" };
  const signal = options.signal ?? AbortSignal.timeout(30_000);
  try {
    const sb = options.client ?? getServiceRoleClient();
    const [dining, channels] = await Promise.all([
      selectAllRows<{ guid: string; name: string }>((from, to) => sb.from("toast_dining_options").select("guid,name")
        .eq("location_id", locationId).order("guid").range(from, to).abortSignal(signal)),
      selectAllRows<{ dining_option_label: string; channel: string; reviewed_at: string | null }>((from, to) => sb.from("sales_channel_map")
        .select("dining_option_label,channel,reviewed_at").order("dining_option_label").range(from, to).abortSignal(signal)),
    ]);
    const { rows } = extractCustomerRows(rawOrders, channelLookup(dining, channels));
    const result = { ...empty };
    const touched = new Set<string>();
    for (const chunk of chunkRows(rows, 500)) {
      if (chunk.length === 0) continue;
      signal.throwIfAborted();
      const { data, error } = await sb.rpc("customer_ingest_orders", { p_location_id: locationId, p_rows: chunk }).abortSignal(signal);
      if (error) throw new Error(error.code === "PGRST202" ? "customer_schema_missing" : "customer_ingest_failed");
      const r = data as { linked: number; skipped: number; created: number; customer_ids: string[] };
      result.linked += r.linked; result.skipped += r.skipped; result.created += r.created;
      for (const id of r.customer_ids ?? []) touched.add(id);
    }
    result.suggestions = await suggestFromCards(sb, [...touched], signal);
    return { ok: true, ...result, error: null };
  } catch (error) {
    // Raw orders hold PII: never surface a provider/DB message.
    const code = error instanceof Error && ["customer_schema_missing"].includes(error.message) ? error.message
      : signal.aborted ? "customer_capture_deadline" : "customer_capture_failed";
    return { ok: false, ...empty, error: code };
  }
}

/** Name + card candidates for the people this run touched → pure scorer → suggestions (never merges). */
export async function suggestFromCards(sb: Client, customerIds: readonly string[], signal?: AbortSignal): Promise<number> {
  let filed = 0;
  for (const chunk of chunkRows(customerIds, 200)) {
    if (chunk.length === 0) continue;
    let q = sb.rpc("customer_card_candidates", { p_customer_ids: chunk });
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) throw new Error("customer_candidates_failed");
    for (const c of (data ?? []) as { customer_id: string; other_id: string; name_key: string | null; other_name_key: string | null; same_shop: boolean; shared_cards: number }[]) {
      const verdict = likelySamePerson({ nameA: c.name_key, nameB: c.other_name_key, sharedCards: c.shared_cards, sameShop: c.same_shop });
      if (!verdict) continue;
      const { data: inserted, error: se } = await sb.rpc("customer_suggest_merge", {
        p_a: c.customer_id, p_b: c.other_id, p_confidence: verdict.confidence, p_reasons: verdict.reasons });
      if (se) throw new Error("customer_suggest_failed");
      if (inserted === true) filed++;
    }
  }
  return filed;
}
