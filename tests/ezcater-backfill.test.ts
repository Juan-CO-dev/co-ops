import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { backfillEzcater, parseBackfillArgs } from "@/scripts/ezcater-backfill";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { syncEzcaterOrder } from "@/lib/ezcater/sync";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/ezcater/sync", () => ({ syncEzcaterOrder: vi.fn() }));

type Row = Record<string, string | boolean>;
let events: Row[];
let rings: Row[];
let leads: Row[] | undefined;
const from = vi.fn();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const receipt = (n: number, overrides: Row = {}): Row => ({
  id: String(n).padStart(12, "0"), entity_id: uuid(n), parent_id: "synthetic-caterer",
  event_key: "accepted", signature_valid: true, "raw->>entity_type": "Order", received_at: "2026-09-05T12:00:00-04:00", ...overrides,
});

// In-memory rows obey the requested filters and pagination, so broadening the historical
// read really includes the out-of-scope sentinels and fails the behavioral assertions.
function query(table: string) {
  let rows: Row[] = [...(table === "ezcater_events" ? events : table === "catering_pipeline" ? leads ?? events.map((r) => ({ id: r.id!, external_ref: r.entity_id!, lead_source: "ezcater" })) : rings)];
  const ordering: string[] = [];
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((key: string, value: string | boolean) => {
      rows = rows.filter((r) => r[key] === value); return chain;
    }),
    gte: vi.fn((key: string, value: string) => {
      rows = rows.filter((r) => String(r[key]) >= value); return chain;
    }),
    lt: vi.fn((key: string, value: string) => {
      rows = rows.filter((r) => String(r[key]) < value); return chain;
    }),
    order: vi.fn((key: string) => { ordering.push(key); return chain; }),
    range: vi.fn(async (start: number, end: number) => ({
      data: rows.sort((a, b) => {
        for (const key of ordering) {
          const comparison = String(a[key]).localeCompare(String(b[key]));
          if (comparison) return comparison;
        }
        return 0;
      }).slice(start, end + 1), error: null,
    })),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  events = []; rings = []; leads = undefined;
  from.mockImplementation(query);
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(syncEzcaterOrder).mockResolvedValue({ lead_id: "synthetic-lead", result: "duplicate" });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("defaults to read-only dry run, deduplicates receipts, and lists pre-webhook rings only", async () => {
  events = [receipt(1), receipt(1, { id: "later", event_key: "modified" })];
  rings = [{ id: "old", order_guid: "pre-webhook-ring", location_id: "synthetic-shop",
    business_date: "2026-09-03", classification: "ezcater" },
  { id: "new", order_guid: "in-history-ring", business_date: "2026-09-04", classification: "ezcater" }];
  expect(await backfillEzcater()).toEqual({ known: 1, leadless: 0, unresolved: 1, applied: 0, failed: 0 });
  expect(syncEzcaterOrder).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"result":"unresolved_pre_webhook_history"'));
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("in-history-ring");
});

it("refuses conflicting caterer parents before any synchronization", async () => {
  events = [receipt(1), receipt(1, { parent_id: "foreign-caterer" })];
  await expect(backfillEzcater({ execute: true, expect: 66 })).rejects.toThrow("backfill_parent_conflict");
  expect(syncEzcaterOrder).not.toHaveBeenCalled();
});

it.each([0, 65, 67])("refuses execution when unique UUID count is %i instead of 66", async (count) => {
  events = Array.from({ length: count }, (_, i) => receipt(i));
  await expect(backfillEzcater({ execute: true, expect: 66 })).rejects.toThrow("backfill_manifest_count_changed_review_required");
  expect(syncEzcaterOrder).not.toHaveBeenCalled();
});

it("executes exactly the 66 signed historical UUIDs, never unresolved rings or outside receipts", async () => {
  events = Array.from({ length: 66 }, (_, i) => receipt(i));
  events.push(receipt(100, { received_at: "2026-09-03T23:59:59-04:00" }),
    receipt(101, { received_at: "2026-10-09T00:00:00-04:00" }),
    receipt(102, { signature_valid: false }), receipt(103, { entity_id: "invalid" }),
    receipt(105, { "raw->>entity_type": "Caterer" }));
  rings = [{ id: "old", order_guid: uuid(104), location_id: "synthetic-shop",
    business_date: "2026-09-03", classification: "ezcater" }];
  expect(await backfillEzcater({ execute: true, expect: 66 })).toEqual({ known: 66, leadless: 0, unresolved: 1, applied: 66, failed: 0 });
  expect(syncEzcaterOrder).toHaveBeenCalledTimes(66);
  expect(vi.mocked(syncEzcaterOrder).mock.calls.map(([id]) => id)).toEqual(
    Array.from({ length: 66 }, (_, i) => uuid(i)));
});

it("deduplicates across receipt pages and preserves latest decisive lifecycle through advisories", async () => {
  events = Array.from({ length: 66 }, (_, i) => receipt(i));
  events.push(...Array.from({ length: 500 }, (_, i) => receipt(0, {
    id: `repeat-${String(i).padStart(4, "0")}`, event_key: "modified",
  })));
  events.push(receipt(0, { id: "z1", event_key: "cancelled", received_at: "2026-09-06T12:00:00-04:00" }),
    receipt(0, { id: "z2", event_key: "succeeded", received_at: "2026-09-07T12:00:00-04:00" }));
  expect((await backfillEzcater({ execute: true, expect: 66 })).known).toBe(66);
  expect(syncEzcaterOrder).toHaveBeenCalledTimes(66);
  expect(syncEzcaterOrder).toHaveBeenCalledWith(uuid(0), "synthetic-caterer", { eventKey: "cancelled" });
  expect(from.mock.calls.filter(([name]) => name === "ezcater_events")).toHaveLength(2);
});

it("retries the same UUID set on a second run and delegates idempotency to synchronization", async () => {
  events = Array.from({ length: 66 }, (_, i) => receipt(i));
  expect((await backfillEzcater({ execute: true, expect: 66 })).applied).toBe(66);
  const first = [...vi.mocked(syncEzcaterOrder).mock.calls];
  vi.mocked(syncEzcaterOrder).mockClear();
  expect((await backfillEzcater({ execute: true, expect: 66 })).applied).toBe(66);
  expect(vi.mocked(syncEzcaterOrder).mock.calls).toEqual(first);
});

it("continues after per-order failures and reports errors without their payloads", async () => {
  events = Array.from({ length: 66 }, (_, i) => receipt(i));
  vi.mocked(syncEzcaterOrder).mockRejectedValueOnce(new Error("PRIVATE ERROR PAYLOAD"))
    .mockResolvedValueOnce({ lead_id: null, result: "error:graphql_error" });
  expect(await backfillEzcater({ execute: true, expect: 66 })).toEqual({ known: 66, leadless: 0, unresolved: 0, applied: 64, failed: 2 });
  expect(syncEzcaterOrder).toHaveBeenCalledTimes(66);
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("PRIVATE ERROR PAYLOAD");
});


it("counts all 68 signed UUIDs but lists and skips the two accepted lead-less failures", async () => {
  events = Array.from({ length: 68 }, (_, i) => receipt(i));
  leads = events.slice(0, 66).map((r) => ({ id: r.id!, external_ref: r.entity_id!, lead_source: "ezcater" }));
  expect(await backfillEzcater({ execute: true, expect: 68 })).toEqual({ known: 68, leadless: 2, unresolved: 0, applied: 66, failed: 0 });
  expect(syncEzcaterOrder).toHaveBeenCalledTimes(66);
  expect(console.log).toHaveBeenCalledWith(JSON.stringify({ provider_uuid: uuid(66), event_key: "accepted", result: "leadless_review_required" }));
  expect(console.log).toHaveBeenCalledWith(JSON.stringify({ provider_uuid: uuid(67), event_key: "accepted", result: "leadless_review_required" }));
});

it("requires the reviewed dry-run count and supports a single existing UUID smoke", async () => {
  events = [receipt(1), receipt(2)];
  await expect(backfillEzcater({ execute: true })).rejects.toThrow("backfill_expected_count_required");
  expect(syncEzcaterOrder).not.toHaveBeenCalled();
  expect((await backfillEzcater({ execute: true, expect: 2, uuid: uuid(2) })).applied).toBe(1);
  expect(syncEzcaterOrder).toHaveBeenCalledExactlyOnceWith(uuid(2), "synthetic-caterer", { eventKey: "accepted" });
});

it("refuses smoke UUIDs absent from the manifest or without a lead", async () => {
  events = [receipt(1)]; leads = [];
  await expect(backfillEzcater({ execute: true, expect: 1, uuid: uuid(2) })).rejects.toThrow("backfill_uuid_outside_manifest");
  await expect(backfillEzcater({ execute: true, expect: 1, uuid: uuid(1) })).rejects.toThrow("backfill_uuid_has_no_lead");
  expect(syncEzcaterOrder).not.toHaveBeenCalled();
});

it("parses explicit count and smoke CLI flags and refuses malformed arguments", () => {
  expect(parseBackfillArgs(["--execute", "--expect", "68", "--uuid", uuid(1)])).toEqual({ execute: true, expect: 68, uuid: uuid(1) });
  for (const args of [["--expect"], ["--expect", "NaN"], ["--expect", "0"], ["--uuid"], ["--typo"]]) {
    expect(() => parseBackfillArgs(args)).toThrow();
  }
});


it.each([
  { result: "stage_moved", sync_error: "graphql_error" },
  { result: "refreshed", sync_error: "timeout" },
  { result: "sync_error" },
])("counts a lifecycle-only result as failed enrichment: %j", async (result) => {
  events = [receipt(1)];
  vi.mocked(syncEzcaterOrder).mockResolvedValueOnce({ lead_id: "synthetic-lead", ...result });
  expect(await backfillEzcater({ execute: true, expect: 1 })).toEqual({
    known: 1, leadless: 0, unresolved: 0, applied: 0, failed: 1,
  });
});
