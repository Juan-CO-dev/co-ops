/**
 * Catering delivery D1 — every query and every RPC `lib/delivery/jobs.ts` + `lib/delivery/settings.ts` build names only
 * columns, relations, functions and arguments that EXIST (a mocked client accepts anything). The loaders and the write
 * wrappers run against a RECORDING client with canned rows that walk them past every read; PGlite applies the harness's
 * stub of the tables 0356 reads plus the REAL 0356 file; every captured query is EXECUTED with `limit 0`, and every
 * captured RPC's argument names are compared with the function's own. The lib never selects `*`.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { STUB } from "../scripts/sql-harness-0356.mjs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no default client in this test"); }) }));

interface Captured { table: string; select: string[]; filters: string[]; order: string[] }
const captured: Captured[] = [];
const rpcs: Array<{ name: string; args: string[] }> = [];

const SHOP = "00000000-0000-4000-8000-00000000000a", LEAD = "00000000-0000-4000-8000-0000000000d1", JOB = "00000000-0000-4000-8000-0000000000e1";
const CANNED: Record<string, unknown> = {
  catering_pipeline: { id: LEAD, location_id: SHOP, stage: "confirmed", lead_source: "website" },
  delivery_settings: { location_id: SHOP, enabled: true, manual_providers: ["Courier A"], gratuity_driver_bps: 1000, updated_at: "2026-11-22T10:00:00Z" },
  locations: [{ id: SHOP, name: "Shop" }],
  delivery_job_current: [{ id: JOB, pipeline_id: LEAD, location_id: SHOP, quote_id: null, confirm_event_id: null, booked_via: "manual", provider_label: "Courier A",
    external_ref: null, attempt_no: 1, pickup_at: null, dropoff_at: null, closed_at: null, created_by: "u", created_at: "2026-11-22T10:00:00Z", status: "accepted", status_seq: 1,
    status_at: "2026-11-22T10:00:00Z" }],
};
const RPC_OK: Record<string, unknown> = {
  delivery_ready: { ready: true, version: 1 },
  set_delivery_settings: { ...(CANNED.delivery_settings as object), open_jobs: 0 },
  record_manual_delivery_job: { job_id: JOB, attempt_no: 1 },
  record_delivery_event: { job_id: JOB, status: "picked_up", status_seq: 2, closed: false, split_id: null },
  record_delivery_cost: { cost_id: "c1" },
  keep_delivery_pickup: { decision_id: "d1" },
  record_delivery_gratuity_split: { split_id: "s1", kind: "split", job_id: JOB, gratuity_cents: 0, driver_bps: 1000, driver_cents: 0, crew_cents: 0 },
};

function recordingClient() {
  return {
    from(table: string) {
      const rec: Captured = { table, select: [], filters: [], order: [] };
      captured.push(rec);
      const q: Record<string, unknown> = {};
      const col = (c: string) => { rec.filters.push(c); return q; };
      const rows = () => { const v = CANNED[table]; return Array.isArray(v) ? v : v ? [v] : []; };
      Object.assign(q, {
        select: (cols: string) => { rec.select = cols.split(",").map((c) => c.trim()).filter(Boolean); return q; },
        eq: col, is: col, in: col,
        order: (c: string) => { rec.order.push(c); return q; },
        range: () => q,
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      });
      return q;
    },
    rpc: (name: string, args: Record<string, unknown> = {}) => { rpcs.push({ name, args: Object.keys(args) }); return Promise.resolve({ data: RPC_OK[name] ?? null, error: null }); },
  } as never;
}
const actor = (role: string, locations: string[]): AuthContext => ({ user: { id: "user-1", role, active: true }, role, level: 0, locations, session: {} } as unknown as AuthContext);

let db: PGlite;
/** How many queries the status-only viewer's load issued (they are the first captured). */
let statusTierQueries = 0;
const previous = process.env.DELIVERY_TRACKING;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(readFileSync("supabase/migrations/0356_delivery_jobs.sql", "utf8").replace(/\r\n/g, "\n"));
  process.env.DELIVERY_TRACKING = "1";
  const jobs = await import("@/lib/delivery/jobs");
  const settings = await import("@/lib/delivery/settings");
  const sb = recordingClient();
  const moo = actor("moo", []);
  // Every projection: the status tier alone (a key holder), status + detail + cost (the MoO), the history tier (the
  // pickup shop's GM of a lead that sits elsewhere), the raw facts.
  await jobs.loadLeadDelivery(actor("key_holder", [SHOP]), LEAD, { client: sb });
  statusTierQueries = captured.length;
  await jobs.loadLeadDelivery(moo, LEAD, { client: sb });
  CANNED.catering_pipeline = { id: LEAD, location_id: "00000000-0000-4000-8000-00000000000b", stage: "confirmed", lead_source: "website" };
  await jobs.loadLeadDelivery(actor("gm", [SHOP]), LEAD, { client: sb });
  await jobs.loadLeadDeliveryFacts(sb, LEAD);
  await settings.loadDeliverySettings(moo, { client: sb });
  await settings.readShopDeliverySettings(sb, SHOP);
  // Every write wrapper.
  await settings.saveDeliverySettings(moo, { locationId: SHOP, values: { enabled: true, manualProviders: ["Courier A"], gratuityDriverBps: 1000 }, expectedUpdatedAt: null }, { client: sb });
  await jobs.recordManualDeliveryJob(moo, { leadId: LEAD, expectedShopId: SHOP, providerLabel: "Courier A", externalRef: null, bookedVia: "manual", pickupAt: null, dropoffAt: null, costCents: null, note: null }, { client: sb });
  await jobs.recordDeliveryEvent(moo, { jobId: JOB, expectedShopId: SHOP, expectedStatus: "accepted", status: "picked_up", occurredAt: null, note: null }, { client: sb });
  await jobs.recordDeliveryCost(moo, { jobId: JOB, expectedShopId: SHOP, component: "base", amountCents: 1, correctsId: null, note: null }, { client: sb });
  await jobs.keepDeliveryPickup(moo, { jobId: JOB, expectedShopId: SHOP, note: null }, { client: sb });
  await jobs.recordDeliveryGratuitySplit(moo, { leadId: LEAD, expectedShopId: SHOP, mode: "recompute", expectedHeadId: null, reason: "x" }, { client: sb });
}, 240_000);
afterAll(async () => {
  if (previous === undefined) delete process.env.DELIVERY_TRACKING; else process.env.DELIVERY_TRACKING = previous;
  await db?.close();
});

describe("lib/delivery against the real 0356 schema", () => {
  it("captured a read of every relation the lib needs", () => {
    const tables = new Set(captured.map((c) => c.table));
    expect([...tables].sort()).toEqual(["catering_pipeline", "catering_quotes", "delivery_gratuity_splits", "delivery_job_costs", "delivery_job_current",
      "delivery_job_events", "delivery_pickup_decisions", "delivery_settings", "ezcater_orders", "locations"]);
  });

  it("every captured query executes against the real relations (limit 0); never select *", async () => {
    expect(captured.length).toBeGreaterThanOrEqual(20);
    for (const c of captured) {
      expect(c.select.length, c.table).toBeGreaterThan(0);
      expect(c.select.some((s) => s.includes("*")), c.table).toBe(false);
      const where = [...new Set(c.filters)].map((f) => `${f} is not distinct from ${f}`).join(" and ") || "true";
      const order = c.order.length ? ` order by ${c.order.join(", ")}` : "";
      const sql = `select ${c.select.join(", ")} from public.${c.table} where ${where}${order} limit 0`;
      await expect(db.query(sql), sql).resolves.toBeDefined();
    }
  });

  it("the status tier's own queries name no restricted relation or column (they execute above like every other)", () => {
    const status = captured.slice(0, statusTierQueries);
    expect(status.length).toBeGreaterThanOrEqual(6);
    expect([...new Set(status.map((c) => c.table))].sort()).toEqual(["catering_pipeline", "catering_quotes", "delivery_job_current", "delivery_pickup_decisions", "delivery_settings", "ezcater_orders"]);
    const columns = status.flatMap((c) => c.select);
    for (const hidden of ["external_ref", "note", "gratuity_cents", "delivery_fee_cents", "amount_cents", "manual_providers", "gratuity_driver_bps"]) {
      expect([hidden, columns.includes(hidden)]).toEqual([hidden, false]);
    }
    // The projections the three tiers and the history view select all exist on the real relations.
    const quoteSelects = new Set(captured.filter((c) => c.table === "catering_quotes").map((c) => c.select.join()));
    expect([...quoteSelects].sort()).toEqual(["id,root_id,status,is_delivery,created_at,superseded_at", "id,status,is_delivery,gratuity_cents,delivery_fee_cents,created_at"]);
    const settingSelects = new Set(captured.filter((c) => c.table === "delivery_settings").map((c) => c.select.join()));
    expect([...settingSelects].sort()).toEqual(["location_id,enabled", "location_id,enabled,manual_providers,gratuity_driver_bps", "location_id,enabled,manual_providers,gratuity_driver_bps,updated_at"]);
    expect(captured.some((c) => c.table === "delivery_job_current" && c.filters.includes("location_id") && c.select.includes("external_ref"))).toBe(true);
  });

  it("every list read is ordered (a paged read needs a stable order)", () => {
    for (const c of captured) {
      const single = (c.table === "catering_pipeline" || c.table === "delivery_settings") && c.filters.length === 1;
      if (!single) expect([c.table, c.order.length > 0]).toEqual([c.table, true]);
    }
  });

  it("the job read is the VIEW (current status = highest seq), never the bare table; quotes are the live revisions only", () => {
    expect(captured.some((c) => c.table === "delivery_jobs")).toBe(false);
    const jobs = captured.find((c) => c.table === "delivery_job_current")!;
    expect(jobs.select).toEqual(expect.arrayContaining(["attempt_no", "status", "status_seq", "status_at", "location_id", "closed_at"]));
    expect(jobs.order[0]).toBe("attempt_no");
    for (const quotes of captured.filter((c) => c.table === "catering_quotes")) expect([...quotes.filters].sort()).toEqual(["pipeline_id", "superseded_at"]);
    expect(captured.find((c) => c.table === "ezcater_orders")!.filters).toEqual(["lead_id"]);
  });

  it("every RPC exists with exactly the argument names the lib sends", async () => {
    const called = new Map(rpcs.map((r) => [r.name, r.args]));
    expect([...called.keys()].sort()).toEqual(["delivery_ready", "keep_delivery_pickup", "record_delivery_cost", "record_delivery_event", "record_delivery_gratuity_split",
      "record_manual_delivery_job", "set_delivery_settings"]);
    for (const [name, args] of called) {
      const row = (await db.query<{ names: string[] | null; n: number }>(
        `select p.proargnames names, p.pronargs n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = $1`, [name])).rows;
      expect([name, row.length]).toEqual([name, 1]);
      const inputs = (row[0]!.names ?? []).slice(0, row[0]!.n);
      expect([name, [...args].sort()]).toEqual([name, [...inputs].sort()]);
    }
  });
});
