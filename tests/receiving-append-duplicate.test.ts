/**
 * Audit W20/B199: the 60-second double-submit guard on "add lines to a delivery" compared the
 * incoming lines with the UNION of every line written in the last minute, the delivery's own
 * creation lines included. A real second pallet identical to the first, added within a minute of
 * creating the delivery, was refused 409 duplicate_append; and a repeat of an earlier append was
 * NOT caught once a different append had followed it. The guard now compares with each earlier
 * append on its own, and never with the lines the delivery was created with.
 *
 * Fix round 1 (review W20-r1, P3): "the lines the delivery was created with" used to be INFERRED
 * from latency (the first line instant within five seconds of the header's). A creation insert
 * delayed past five seconds was classified as an append, and the identical second pallet was
 * refused again. The creation lines now CARRY the header's own created_at (written by
 * recordDelivery / record_delivery_atomic): creation = that exact instant, nothing inferred.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email-receipts", () => ({ attemptReceivingAutoLink: vi.fn(async () => {}) }));
vi.mock("@/lib/prep-consumption", () => ({ loadMeasures: vi.fn(async () => new Map()), loadSkuPackChains: vi.fn(async () => new Map()) }));

import { getServiceRoleClient } from "@/lib/supabase-server";
import { addDeliveryLines, recordDelivery } from "@/lib/receiving";
import * as receivingShared from "@/lib/receiving-shared";
import { isDuplicateOfAnyBatch, priorAppendBatches, sameInstant, type AppendLine, type DatedAppendLine } from "@/lib/receiving-shared";

const SHOP = "11111111-1111-4111-8111-111111111111";
const VENDOR = "44444444-4444-4444-8444-444444444444";
const ROLL = "55555555-5555-4555-8555-555555555555";
const HAM = "66666666-6666-4666-8666-666666666666";
const actor = { user: { id: "user", role: "key_holder" }, locations: [SHOP] } as never;

const T0 = "2026-11-14T15:00:00.000000+00:00";
const at = (seconds: number) => new Date(Date.parse("2026-11-14T15:00:00.000Z") + seconds * 1000).toISOString().replace("Z", "000+00:00");
const roll4: AppendLine = { skuId: ROLL, level: "case", qty: 4 };
const ham2: AppendLine = { skuId: HAM, level: null, qty: 2 };
const dated = (line: AppendLine, createdAt: string): DatedAppendLine => ({ ...line, createdAt });

describe("isDuplicateOfAnyBatch", () => {
  it("matches one batch exactly, never a union of batches", () => {
    expect(isDuplicateOfAnyBatch([roll4], [[roll4]])).toBe(true);
    expect(isDuplicateOfAnyBatch([roll4, ham2], [[ham2, roll4]])).toBe(true);
    // Two separate appends are not one append of both.
    expect(isDuplicateOfAnyBatch([roll4, ham2], [[roll4], [ham2]])).toBe(false);
    expect(isDuplicateOfAnyBatch([roll4], [[roll4, ham2]])).toBe(false);
    expect(isDuplicateOfAnyBatch([{ ...roll4, qty: 5 }], [[roll4]])).toBe(false);
    expect(isDuplicateOfAnyBatch([roll4], [])).toBe(false);
    expect(isDuplicateOfAnyBatch([], [[roll4]])).toBe(false);
  });
  it("a repeat of an earlier append is caught even after a different append followed it", () => {
    expect(isDuplicateOfAnyBatch([roll4], [[roll4], [ham2]])).toBe(true);
    expect(isDuplicateOfAnyBatch([ham2], [[roll4], [ham2]])).toBe(true);
  });
});

describe("priorAppendBatches", () => {
  it("groups lines by the insert that wrote them", () => {
    expect(priorAppendBatches([dated(roll4, at(70)), dated(ham2, at(70)), dated(roll4, at(90))], T0))
      .toEqual([[roll4, ham2], [roll4]]);
  });
  it("leaves out the lines the delivery was created with: the ones that carry the header's own instant", () => {
    expect(priorAppendBatches([dated(roll4, T0), dated(roll4, at(20))], T0)).toEqual([[roll4]]);
    expect(priorAppendBatches([dated(roll4, T0), dated(ham2, T0)], T0)).toEqual([]);
  });
  it("review W20-r1: identity, not latency. A stamp that is not the header's is an append however close it is", () => {
    // 250 ms after the header is NOT the header's instant: nothing is inferred from "a moment later".
    expect(priorAppendBatches([dated(roll4, at(0.25))], T0)).toEqual([[roll4]]);
    expect(priorAppendBatches([dated(roll4, "2026-11-14T15:00:00.000001+00:00")], T0)).toEqual([[roll4]]);
    // ...and the creation lines stay creation lines however late their insert ran: they carry the stamp.
    expect(priorAppendBatches([dated(roll4, T0), dated(roll4, at(45))], T0)).toEqual([[roll4]]);
    expect("CREATION_BATCH_SLACK_MS" in receivingShared).toBe(false);
  });
  it("a delivery with no creation lines (or no header instant) has no creation batch", () => {
    // An in-progress delivery saved empty (a leftover of the old failed saves): its first lines ARE an append.
    expect(priorAppendBatches([dated(roll4, at(600))], T0)).toEqual([[roll4]]);
    expect(priorAppendBatches([dated(roll4, at(600))], null)).toEqual([[roll4]]);
    expect(priorAppendBatches([], T0)).toEqual([]);
  });
  it("sameInstant compares the instant to the microsecond, whatever the spelling", () => {
    expect(sameInstant("2026-11-14T15:00:00.123456+00:00", "2026-11-14T15:00:00.123456+00:00")).toBe(true);
    expect(sameInstant("2026-11-14T15:00:00.123456+00:00", "2026-11-14T15:00:00.123456Z")).toBe(true);
    expect(sameInstant("2026-11-14T15:00:00.1+00:00", "2026-11-14T15:00:00.100000+00:00")).toBe(true);
    expect(sameInstant("2026-11-14T15:00:00+00:00", "2026-11-14T10:00:00.000-05:00")).toBe(true);
    expect(sameInstant("2026-11-14T15:00:00.123456+00:00", "2026-11-14T15:00:00.123457+00:00")).toBe(false);
    expect(sameInstant("2026-11-14T15:00:00.123+00:00", "2026-11-14T15:00:00.124+00:00")).toBe(false);
    expect(sameInstant(null, "2026-11-14T15:00:00+00:00")).toBe(false);
    expect(sameInstant("not a date", "not a date")).toBe(false);
  });
});

// ── addDeliveryLines against an in-memory delivery ─────────────────────────────────────────────
type Row = Record<string, unknown>;
let lines: Row[];
let header: Row;
let now: number;
/** recordDelivery's atomic writer: missing (0327 not applied) unless a test installs one. */
let atomicRpc: ((args: Row) => { data: unknown; error: { code?: string; message: string } | null }) | null;
/** How long the request "waits" between the header insert and the line insert (the review's delayed creation). */
let delayAfterHeaderMs = 0;
function client() {
  return { from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let limit: number | null = null;
    let inserted: Row[] | null = null;
    const q: Record<string, unknown> = {};
    q.select = () => q; q.returns = () => q; q.maybeSingle = () => q; q.in = () => q; q.is = () => q; q.not = () => q;
    q.eq = (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; };
    q.gte = (k: string, v: string) => { filters.push(r => Date.parse(String(r[k])) >= Date.parse(v)); return q; };
    q.order = () => q;
    q.limit = (n: number) => { limit = n; return q; };
    q.insert = (rows: Row[] | Row) => {
      if (table === "vendor_deliveries") {
        header = { id: "d1", ...(rows as Row), created_at: new Date(now).toISOString() };
        now += delayAfterHeaderMs;
        return q;
      }
      inserted = rows as Row[]; return q;
    };
    q.then = (resolve: (value: unknown) => unknown) => {
      let data: unknown = [];
      if (table === "vendor_deliveries") data = header;
      else if (table === "vendors") data = { id: VENDOR, source_kind: "vendor" };
      else if (table === "vendor_items") data = [ROLL, HAM].map(id => ({ id, vendor_id: VENDOR, location_id: null, pack_format: null,
        each_container_label: null, units_per_pack: 1, each_size: null, each_measure: null, avg_oz_per_each: null, weight_class: null }));
      else if (table === "vendor_delivery_items") {
        // Like the column default: now() unless the row carries its own created_at.
        if (inserted) { const createdAt = new Date(now).toISOString(); lines.push(...inserted.map(r => ({ created_at: createdAt, ...r }))); data = null; }
        else {
          const matched = lines.filter(r => filters.every(f => f(r))).sort((a, b) => Date.parse(String(a.created_at)) - Date.parse(String(b.created_at)));
          data = limit ? matched.slice(0, limit) : matched;
        }
      }
      return Promise.resolve({ data, error: null, count: 1 }).then(resolve);
    };
    return q;
  }, rpc: async (fn: string, args: Row) => {
    if (fn !== "record_delivery_atomic") return { data: null, error: null };
    return atomicRpc ? atomicRpc(args) : { data: null, error: { code: "PGRST202", message: "Could not find the function public.record_delivery_atomic" } };
  } };
}
const stored = (skuId: string, qty: number, level: string | null, createdAt: string): Row =>
  ({ delivery_id: "d1", vendor_item_id: skuId, qty_received: qty, received_level_label: level, received_qty_at_level: level ? qty : null, created_at: createdAt, discrepancy_type: null });
const START = Date.parse("2026-11-14T15:00:00.000Z");
const iso = (seconds: number) => new Date(START + seconds * 1000).toISOString();
const append = (items: Array<{ skuId: string; qtyReceived: number; receivedLevelLabel?: string }>) => addDeliveryLines(actor, "d1", items);
const pallet = [{ skuId: ROLL, qtyReceived: 4, receivedLevelLabel: "case" }];

beforeEach(() => {
  vi.clearAllMocks();
  header = { id: "d1", vendor_id: VENDOR, location_id: SHOP, delivery_date: "2026-11-14", delivery_status: "in_progress", created_at: iso(0) };
  lines = [stored(ROLL, 4, "case", iso(0))]; // the delivery was created with one line: 4 cases of rolls
  now = START;
  atomicRpc = null; delayAfterHeaderMs = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.mocked(getServiceRoleClient).mockReturnValue(client() as never);
});

describe("W20/B199 addDeliveryLines double-submit guard", () => {
  it("a real second pallet, identical to the creation lines, saves ten seconds after the delivery was created", async () => {
    now = START + 10_000;
    await expect(append(pallet)).resolves.toEqual({ added: 1 });
    expect(lines).toHaveLength(2);
  });
  it("re-sending that same append is still refused", async () => {
    now = START + 10_000;
    await append(pallet);
    now = START + 12_000;
    await expect(append(pallet)).rejects.toMatchObject({ status: 409, code: "duplicate_append" });
    expect(lines).toHaveLength(2);
  });
  it("a repeat of an earlier append is refused even after a different append followed it", async () => {
    now = START + 10_000; await append(pallet);
    now = START + 20_000; await append([{ skuId: HAM, qtyReceived: 2 }]);
    now = START + 30_000;
    await expect(append(pallet)).rejects.toMatchObject({ status: 409, code: "duplicate_append" });
    await expect(append([{ skuId: HAM, qtyReceived: 2 }])).rejects.toMatchObject({ status: 409, code: "duplicate_append" });
    expect(lines).toHaveLength(3);
  });
  it("two earlier appends are not mistaken for one append of both", async () => {
    now = START + 10_000; await append(pallet);
    now = START + 20_000; await append([{ skuId: HAM, qtyReceived: 2 }]);
    now = START + 30_000;
    await expect(append([...pallet, { skuId: HAM, qtyReceived: 2 }])).resolves.toEqual({ added: 2 });
  });
  it("after the window the same lines are a new append, as before", async () => {
    now = START + 10_000; await append(pallet);
    now = START + 71_000;
    await expect(append(pallet)).resolves.toEqual({ added: 1 });
  });
  it("on a delivery saved with no lines, the first lines are an append and their repeat is refused", async () => {
    lines = [];
    now = START + 600_000; await append(pallet);
    now = START + 602_000;
    await expect(append(pallet)).rejects.toMatchObject({ status: 409, code: "duplicate_append" });
  });
});

describe("review W20-r1 (P3): the creation lines carry the header's instant, however slow the save was", () => {
  const create = () => recordDelivery(actor, { locationId: SHOP, vendorId: VENDOR, deliveryDate: "2026-11-14", deliveryStatus: "in_progress",
    lines: [{ skuId: ROLL, qtyReceived: 4, receivedLevelLabel: "case" }] } as never);
  beforeEach(() => { lines = []; header = {}; });

  it("before 0327: a line insert that ran 8 seconds after the header is still the creation batch", async () => {
    delayAfterHeaderMs = 8_000; // the header request, then the line request more than five seconds later
    await create();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.created_at).toBe(header.created_at);
    expect(now).toBe(START + 8_000);
    // A real second pallet, identical to the first, inside the minute: saved (it used to be duplicate_append).
    now = START + 20_000;
    await expect(append(pallet)).resolves.toEqual({ added: 1 });
    expect(lines).toHaveLength(2);
    // Re-sending THAT append is still refused.
    now = START + 22_000;
    await expect(append(pallet)).rejects.toMatchObject({ status: 409, code: "duplicate_append" });
    expect(lines).toHaveLength(2);
  });
  it("before 0327: a 30-second line insert is still the creation batch (no bound at all)", async () => {
    delayAfterHeaderMs = 30_000;
    await create();
    now = START + 45_000;
    await expect(append(pallet)).resolves.toEqual({ added: 1 });
  });
  it("with 0327: the one-transaction writer's lines carry the header's instant, and the second pallet saves", async () => {
    atomicRpc = (args) => {
      const createdAt = new Date(now).toISOString();
      header = { id: "d1", ...(args.p_header as Row), created_at: createdAt };
      lines.push(...(args.p_lines as Row[]).map(r => ({ ...r, delivery_id: "d1", created_at: createdAt })));
      return { data: { delivery_id: "d1", item_ids: ["i1"] }, error: null };
    };
    await create();
    now = START + 10_000;
    await expect(append(pallet)).resolves.toEqual({ added: 1 });
    now = START + 12_000;
    await expect(append(pallet)).rejects.toMatchObject({ status: 409, code: "duplicate_append" });
  });
});
