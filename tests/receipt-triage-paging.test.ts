/**
 * Audit W20/B195: the receiving triage queue read every unlinked receipt with no range, so past
 * the API's 1,000-row cap the OLDEST unlinked receipts silently vanished, and it signed one
 * preview URL per row (1,000 storage calls in parallel). It is now paged (newest 100, a total,
 * "more"), with one bulk signing call per page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const mocks = vi.hoisted(() => ({ client: vi.fn(), allowed: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: mocks.allowed, auditOperationalTaskOverride: vi.fn(), canTriageUnattributedReceipt: vi.fn(async () => true) }));
vi.mock("@/lib/purchase-orders", () => ({ autoPlaceOnEmailEvidence: vi.fn() }));

import { listUnlinkedReceipts, TRIAGE_PAGE_SIZE } from "@/lib/email-receipts";

const SHOP = "11111111-1111-4111-8111-111111111111";
const actor = { user: { id: "u", role: "gm" }, locations: [SHOP] } as unknown as AuthContext;

type Row = Record<string, unknown>;
let queue: Row[];
let calls: { range: Array<[number, number]>; order: Array<[string, unknown]>; select: Array<[string, unknown]>; signBulk: string[][]; signOne: number; headCounts: number };
let signFails: Set<string>;
let bulkError = false;

const row = (i: number, extra: Row = {}): Row => ({
  id: `r${String(i).padStart(4, "0")}`, source: "inbound", from_address: "billing@vendor.example", subject: `Invoice ${i}`,
  received_at: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(), location_id: SHOP, vendor_guess_id: null,
  raw_storage_path: `${SHOP}/a${i}/message.eml`, attachment_paths: [], linked_po_id: null, parse_state: "parsed", doc_kind: "invoice",
  attributed_by: "address", attribution_conflict: false, account_location_id: null, account_vendor_id: null, ...extra,
});

function client() {
  return {
    from(table: string) {
      let range: [number, number] | null = null;
      let head = false;
      const filters: ((r: Row) => boolean)[] = [];
      const q: Record<string, unknown> = {};
      q.select = (cols: string, opts?: { count?: string; head?: boolean }) => { calls.select.push([cols, opts]); head = !!opts?.head; return q; };
      q.is = () => q; q.or = () => q; q.returns = () => q;
      q.eq = (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; };
      q.in = () => q;
      q.order = (k: string, o: unknown) => { calls.order.push([k, o]); return q; };
      q.range = (a: number, b: number) => { range = [a, b]; calls.range.push([a, b]); return q; };
      q.then = (resolve: (v: unknown) => unknown) => {
        if (table !== "email_receipts") return Promise.resolve({ data: [], error: null }).then(resolve);
        const matched = queue.filter(r => filters.every(f => f(r)));
        if (head) { calls.headCounts += 1; return Promise.resolve({ data: null, error: null, count: matched.length }).then(resolve); }
        // Newest first, id as the tiebreak: the order the query asks for.
        const sorted = [...matched].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)) || String(b.id).localeCompare(String(a.id)));
        const page = range ? sorted.slice(range[0], range[1] + 1) : sorted.slice(0, 1000); // no range = the API's silent cap
        return Promise.resolve({ data: page, error: null, count: matched.length }).then(resolve);
      };
      return q;
    },
    storage: { from: () => ({
      createSignedUrl: async () => { calls.signOne += 1; return { data: { signedUrl: "one" }, error: null }; },
      createSignedUrls: async (paths: string[]) => {
        calls.signBulk.push(paths);
        if (bulkError) return { data: null, error: { message: "storage down" } };
        return { data: paths.map(path => signFails.has(path) ? { error: "not found", path, signedUrl: null } : { error: null, path, signedUrl: `signed:${path}` }), error: null };
      },
    }) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed.mockResolvedValue(true);
  calls = { range: [], order: [], select: [], signBulk: [], signOne: 0, headCounts: 0 };
  signFails = new Set(); bulkError = false;
  queue = Array.from({ length: 1500 }, (_, i) => row(i));
  mocks.client.mockReturnValue(client());
});

describe("W20/B195 the triage queue is paged", () => {
  it("asks for a bounded range, newest first, and reports the total and that more exist", async () => {
    const page = await listUnlinkedReceipts(actor, SHOP);
    expect(TRIAGE_PAGE_SIZE).toBe(100);
    expect(calls.range).toEqual([[0, 99]]);
    expect(calls.order).toEqual([["received_at", { ascending: false }], ["id", { ascending: false }]]);
    expect(calls.select[0]?.[1]).toEqual({ count: "exact" });
    expect(page.receipts).toHaveLength(100);
    expect(page.receipts[0]?.id).toBe("r1499");
    expect(page).toMatchObject({ total: 1500, hasMore: true, flagged: 0 });
  });
  it("the oldest receipts are reachable: the last page ends the list", async () => {
    const page = await listUnlinkedReceipts(actor, SHOP, { offset: 1400 });
    expect(calls.range).toEqual([[1400, 1499]]);
    expect(page.receipts.at(-1)?.id).toBe("r0000");
    expect(page).toMatchObject({ total: 1500, hasMore: false });
    const past = await listUnlinkedReceipts(actor, SHOP, { offset: 1500 });
    expect(past).toMatchObject({ receipts: [], total: 1500, hasMore: false });
  });
  it("walking every page returns every receipt exactly once", async () => {
    const seen: string[] = [];
    for (let offset = 0; ; offset += TRIAGE_PAGE_SIZE) {
      const page = await listUnlinkedReceipts(actor, SHOP, { offset });
      seen.push(...page.receipts.map(r => r.id));
      if (!page.hasMore) break;
    }
    expect(seen).toHaveLength(1500);
    expect(new Set(seen).size).toBe(1500);
  });
  it.each([[0, 1], [-5, 1], [1000, 100], [2.5, 2], [Number.NaN, 100]])("page size %s is clamped to %s", async (pageSize, expected) => {
    const page = await listUnlinkedReceipts(actor, SHOP, { pageSize });
    expect(page.receipts).toHaveLength(expected);
    expect(calls.range).toEqual([[0, expected - 1]]);
  });
  it.each([-1, 1.5, Number.NaN])("offset %s is refused", async offset => {
    await expect(listUnlinkedReceipts(actor, SHOP, { offset })).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    expect(calls.range).toEqual([]);
  });
  it("previews are signed once per page, in bulk, never one call per row", async () => {
    const page = await listUnlinkedReceipts(actor, SHOP);
    expect(calls.signOne).toBe(0);
    expect(calls.signBulk).toHaveLength(1);
    expect(calls.signBulk[0]).toHaveLength(100);
    expect(page.receipts[0]?.previewUrl).toBe(`signed:${SHOP}/a1499/message.eml`);
  });
  it("a row with nothing stored is not sent for signing, and a failed entry is null", async () => {
    queue = [row(1, { raw_storage_path: null, attachment_paths: [{ filename: "x.pdf", contentType: "application/pdf", path: null, omitted: true }] }),
      row(2), row(3, { raw_storage_path: null, attachment_paths: [{ filename: "inv.pdf", contentType: "application/pdf", path: "p/inv.pdf" }] })];
    signFails = new Set([`${SHOP}/a2/message.eml`]);
    const page = await listUnlinkedReceipts(actor, SHOP);
    expect(calls.signBulk).toEqual([["p/inv.pdf", `${SHOP}/a2/message.eml`]]);
    expect(page.receipts.map(r => r.previewUrl)).toEqual(["signed:p/inv.pdf", null, null]);
  });
  it("a storage outage still lists the queue, with no previews", async () => {
    queue = [row(1), row(2)]; bulkError = true;
    const page = await listUnlinkedReceipts(actor, SHOP);
    expect(page.receipts.map(r => r.previewUrl)).toEqual([null, null]);
    expect(page.total).toBe(2);
  });
  it("an empty queue makes no signing call", async () => {
    queue = [];
    expect(await listUnlinkedReceipts(actor, SHOP)).toEqual({ receipts: [], total: 0, hasMore: false, flagged: 0 });
    expect(calls.signBulk).toEqual([]);
  });
  it("counts every flagged receipt in the queue, not only the loaded page", async () => {
    queue = Array.from({ length: 250 }, (_, i) => row(i, i < 7 ? { attribution_conflict: true, account_location_id: SHOP, account_vendor_id: "v2", vendor_guess_id: "v1" } : {}));
    const page = await listUnlinkedReceipts(actor, SHOP);
    // The 7 flagged rows are the OLDEST: none is on the first page, the pill still says 7.
    expect(page.receipts.some(r => r.attributionConflict)).toBe(false);
    expect(page.flagged).toBe(7);
    const last = await listUnlinkedReceipts(actor, SHOP, { offset: 200 });
    expect(last.receipts.filter(r => r.conflictKind === "vendor")).toHaveLength(7);
  });
  it("the move permission is worked out once per shop pair, not once per row", async () => {
    queue = Array.from({ length: 40 }, (_, i) => row(i, { attribution_conflict: true, account_location_id: SHOP }));
    const page = await listUnlinkedReceipts(actor, SHOP);
    expect(page.receipts.every(r => r.canMove)).toBe(true);
    // 1 for the queue's own gate + one pair (from, to) = 2 checks; never 40 rows x 2.
    expect(mocks.allowed.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
