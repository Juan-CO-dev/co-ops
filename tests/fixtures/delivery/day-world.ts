/**
 * Catering delivery D3 fixtures: a small world of leads, jobs, decisions, quotes and ezCater rows, answered through the
 * recording client the way PostgREST would (the filters applied, ONLY the selected columns returned). Every row also
 * carries SENTINEL fields a money-free reader must never select; because the fake projects by the select list, a
 * sentinel can reach a result only if the loader asked for its column.
 */
import type { FakeCall } from "../../helpers/fake-supabase";

export const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const DAY = "2026-11-18";
export const SENTINELS = ["Sentinel Contact", "Sentinel Co", "1 Sentinel Way", "Sentinel Courier", "SENTINEL-REF", "sentinel note", 987654321, 135792468] as const;

type Row = Record<string, unknown>;
export interface World {
  settings: Row[]; leads: Row[]; jobs: Row[]; decisions: Row[]; quotes: Row[]; ezcater: Row[];
  /** The leads' shops as the re-check (the read AFTER every other read) sees them; absent = unchanged. */
  after?: Record<string, string | null>;
  /** A table whose reads fail, with this error. */
  fail?: { table: string; error: { code?: string; message: string } };
}

let seq = 0;
export const lead = (id: string, over: Row = {}): Row => ({
  id, location_id: A, stage: "confirmed", lead_source: "website", event_date: DAY, contact_name: SENTINELS[0], company: SENTINELS[1], delivery_address: SENTINELS[2],
  estimated_revenue_cents: SENTINELS[6], ...over });
export const job = (pipelineId: string, attemptNo: number, status: string, over: Row = {}): Row => {
  const closed = ["delivered", "cancelled", "failed", "returned"].includes(status);
  return { id: `job-${pipelineId}-${attemptNo}`, pipeline_id: pipelineId, location_id: A, attempt_no: attemptNo, status, status_at: "2026-11-18T15:00:00.000Z", status_seq: 1,
    pickup_at: null, dropoff_at: null, closed_at: closed ? "2026-11-18T15:00:00.000Z" : null, provider_label: SENTINELS[3], external_ref: SENTINELS[4], booked_via: "manual",
    quote_id: null, confirm_event_id: null, created_by: "u", created_at: "2026-11-18T10:00:00.000Z", ...over };
};
export const quote = (pipelineId: string, status: string, over: Row = {}): Row => ({
  id: `q-${pipelineId}-${seq += 1}`, pipeline_id: pipelineId, status, is_delivery: true, created_at: "2026-11-10T10:00:00.000Z", superseded_at: null,
  total_cents: SENTINELS[6], delivery_fee_cents: SENTINELS[7], gratuity_cents: SENTINELS[7], ...over });
export const decision = (jobId: string, leadLocationId: string): Row => ({ id: `d-${jobId}-${leadLocationId}`, job_id: jobId, lead_location_id: leadLocationId, decided_by: "u",
  decided_at: "2026-11-18T12:00:00.000Z", note: SENTINELS[5] });
export const on = (shop: string, enabled = true): Row => ({ location_id: shop, enabled, manual_providers: [SENTINELS[3]], gratuity_driver_bps: 1000, updated_at: "x" });

const TABLES: Record<string, keyof Omit<World, "after" | "fail">> = {
  delivery_settings: "settings", catering_pipeline: "leads", delivery_job_current: "jobs", delivery_pickup_decisions: "decisions", catering_quotes: "quotes", ezcater_orders: "ezcater",
};

/** The responder for `fakeSupabase`: filters applied, the selected columns only. Unknown tables answer `fallback`. */
export function worldResponder(world: World, fallback: (c: FakeCall) => { data?: unknown; error?: unknown } = () => ({ data: [] })) {
  return (c: FakeCall): { data?: unknown; error?: unknown } => {
    const key = TABLES[c.table];
    if (!key) return fallback(c);
    if (world.fail?.table === c.table) return { error: world.fail.error };
    const columns = String(c.arg("select") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    let rows: Row[] = world[key];
    // The shop re-check is the one lead read that asks for `id,location_id` alone.
    if (c.table === "catering_pipeline" && columns.join() === "id,location_id" && world.after) {
      rows = rows.map((r) => (String(r.id) in world.after! ? { ...r, location_id: world.after![String(r.id)] } : r));
    }
    for (const o of c.ops) {
      const [col, value] = o.args as [string, unknown];
      if (o.op === "eq") rows = rows.filter((r) => r[col] === value);
      else if (o.op === "in") rows = rows.filter((r) => (value as unknown[]).includes(r[col]));
      else if (o.op === "is") rows = rows.filter((r) => (r[col] ?? null) === value);
    }
    const from = (c.arg("range", 0) as number | undefined) ?? 0;
    const page = rows.slice(from, from + 1000).map((r) => Object.fromEntries(columns.map((k) => [k, r[k] ?? null])));
    return { data: c.has("maybeSingle") ? page[0] ?? null : page };
  };
}
