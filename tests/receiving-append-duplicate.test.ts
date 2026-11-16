/**
 * Audit W20/B199: the 60-second double-submit guard on "add lines to a delivery" compared the
 * incoming lines with the UNION of every line written in the last minute, the delivery's own
 * creation lines included. A real second pallet identical to the first, added within a minute of
 * creating the delivery, was refused 409 duplicate_append; and a repeat of an earlier append was
 * NOT caught once a different append had followed it. The guard now compares with each earlier
 * append on its own, and never with the lines the delivery was created with.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email-receipts", () => ({ attemptReceivingAutoLink: vi.fn(async () => {}) }));
vi.mock("@/lib/prep-consumption", () => ({ loadMeasures: vi.fn(async () => new Map()), loadSkuPackChains: vi.fn(async () => new Map()) }));

import { getServiceRoleClient } from "@/lib/supabase-server";
import { addDeliveryLines } from "@/lib/receiving";
import { isDuplicateOfAnyBatch, priorAppendBatches, type AppendLine, type DatedAppendLine } from "@/lib/receiving-shared";

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
    expect(priorAppendBatches([dated(roll4, at(70)), dated(ham2, at(70)), dated(roll4, at(90))], { headerCreatedAt: T0, firstLineCreatedAt: T0 }))
      .toEqual([[roll4, ham2], [roll4]]);
  });
  it("leaves out the lines the delivery was created with (same instant as the header, or just after it)", () => {
    // One transaction (migration 0327): the header and its lines share one instant.
    expect(priorAppendBatches([dated(roll4, T0), dated(roll4, at(20))], { headerCreatedAt: T0, firstLineCreatedAt: T0 })).toEqual([[roll4]]);
    // The older two-step write: the lines land a moment after the header.
    const justAfter = at(0.25);
    expect(priorAppendBatches([dated(roll4, justAfter)], { headerCreatedAt: T0, firstLineCreatedAt: justAfter })).toEqual([]);
  });
  it("a delivery whose first lines came long after its header has no creation batch among them", () => {
    // An in-progress delivery saved empty (a leftover of the old failed saves): its first lines ARE an append.
    expect(priorAppendBatches([dated(roll4, at(600))], { headerCreatedAt: T0, firstLineCreatedAt: at(600) })).toEqual([[roll4]]);
    expect(priorAppendBatches([dated(roll4, at(600))], { headerCreatedAt: null, firstLineCreatedAt: at(600) })).toEqual([[roll4]]);
    expect(priorAppendBatches([], { headerCreatedAt: T0, firstLineCreatedAt: null })).toEqual([]);
  });
});

// ── addDeliveryLines against an in-memory delivery ─────────────────────────────────────────────
type Row = Record<string, unknown>;
let lines: Row[];
let header: Row;
let now: number;
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
    q.insert = (rows: Row[]) => { inserted = rows; return q; };
    q.then = (resolve: (value: unknown) => unknown) => {
      let data: unknown = [];
      if (table === "vendor_deliveries") data = header;
      else if (table === "vendors") data = { source_kind: "vendor" };
      else if (table === "vendor_items") data = [ROLL, HAM].map(id => ({ id, vendor_id: VENDOR, location_id: null, pack_format: null,
        each_container_label: null, units_per_pack: 1, each_size: null, each_measure: null, avg_oz_per_each: null, weight_class: null }));
      else if (table === "vendor_delivery_items") {
        if (inserted) { const createdAt = new Date(now).toISOString(); lines.push(...inserted.map(r => ({ ...r, created_at: createdAt }))); data = null; }
        else {
          const matched = lines.filter(r => filters.every(f => f(r))).sort((a, b) => Date.parse(String(a.created_at)) - Date.parse(String(b.created_at)));
          data = limit ? matched.slice(0, limit) : matched;
        }
      }
      return Promise.resolve({ data, error: null, count: 1 }).then(resolve);
    };
    return q;
  }, rpc: async () => ({ data: null, error: null }) };
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
