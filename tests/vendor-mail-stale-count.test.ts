/**
 * Nav PR 8 (plan r2 2.13, Q7): `staleVendorMailCount` is the length of the stale list the link opens
 * (`listVendorMail(ctx, { stale: true, locationId })`), on the same fake (T-V1), and every read it makes, the reader's
 * own role and membership re-read included, carries the signal (T-D3, A3). Without a signal nothing changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: client }));
import { listVendorMail, staleVendorMailCount } from "@/lib/vendor-mail";
import type { RoleCode } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const me = "11111111-1111-4111-8111-111111111111";
const shop = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const OLD = "2026-11-09T10:00:00Z", NEW = "2026-11-11T11:00:00Z";
let n = 0;
function message(extra: Row = {}): Row {
  n += 1;
  const id = `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
  return { id, reference_code: `VM-${n}`, revision: 0, received_at: OLD, from_address: "s@example.com", subject: "Invoice", effective_location_id: shop, effective_vendor_id: null,
    content_state: "pending", display_status: "received", search_text: "Invoice", last_error: null, email_receipt_id: null, handled_by: null, handled_at: null, handled_reason: null,
    archive_state: "pending", archive_error: null, attachment_manifest: [], receipt: null, is_stale: true, ...extra };
}
function setup(rows: Row[], role: RoleCode = "gm", memberships = [shop]) {
  const tables: Record<string, Row[]> = { users: [{ id: me, active: true, role }], user_locations: memberships.map((location_id) => ({ user_id: me, location_id, active: true })), vendor_mail_read: rows };
  const reads: Array<{ table: string; signal: AbortSignal | null }> = [];
  client.mockImplementation(() => ({ from: (table: string) => {
    const read = { table, signal: null as AbortSignal | null };
    reads.push(read);
    const filters: Array<(row: Row) => boolean> = []; let first = 0; let last = Infinity; let single = false;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    for (const method of ["eq", "is", "in", "gte", "lte"]) q[method] = (key: string, value: unknown) => {
      filters.push((row) => method === "in" ? (value as unknown[]).includes(row[key]) : method === "is" ? (row[key] ?? null) === value : row[key] === value); return q;
    };
    q.order = () => q; q.range = (a: number, b: number) => { first = a; last = b; return q; };
    q.maybeSingle = () => { single = true; return q; };
    q.abortSignal = (s: AbortSignal) => { read.signal = s; return q; };
    q.then = (resolve: (value: unknown) => unknown) => { const sel = (tables[table] ?? []).filter((row) => filters.every((f) => f(row))).slice(first, last + 1); return Promise.resolve({ data: single ? sel[0] ?? null : sel, error: null }).then(resolve); };
    return q;
  } }));
  return { ctx: { user: { id: me, role, active: true }, session: { id: "s" } } as unknown as AuthContext, reads };
}
const ROWS = () => [
  message(), message(), // stale at the shop
  message({ received_at: NEW, is_stale: false }), // fresh
  message({ handled_at: "2026-11-10T10:00:00Z", is_stale: false }), // handled
  message({ effective_location_id: other }), // another shop
  message({ effective_location_id: null }), // no shop
];
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T12:00:00Z")); n = 0; });
afterEach(() => vi.useRealTimers());

describe("T-V1: the count is the stale list's length", () => {
  it.each(["gm", "moo", "owner", "cgs"] as RoleCode[])("%s at the shop", async (role) => {
    const { ctx } = setup(ROWS(), role);
    const list = await listVendorMail(ctx, { stale: true, locationId: shop });
    const count = await staleVendorMailCount(ctx, { locationId: shop });
    expect(count).toBe(list.messages.length);
    expect(count).toBe(2);
  });

  it("a GM at a foreign shop gets 0 rows (canReadVendorMail); a MoO reads it", async () => {
    expect(await staleVendorMailCount(setup(ROWS(), "gm").ctx, { locationId: other })).toBe(0);
    expect(await staleVendorMailCount(setup(ROWS(), "moo", []).ctx, { locationId: other })).toBe(1);
  });

  it("a row the view marks stale but that is not stale now is not counted (the list's own vendorMailStale)", async () => {
    const { ctx } = setup([message({ received_at: NEW, is_stale: true }), message()]);
    expect(await staleVendorMailCount(ctx, { locationId: shop })).toBe((await listVendorMail(ctx, { stale: true, locationId: shop })).messages.length);
    expect(await staleVendorMailCount(ctx, { locationId: shop })).toBe(1);
  });

  it("refuses a role that may not read vendor mail before any read", async () => {
    const { ctx, reads } = setup(ROWS(), "agm");
    await expect(staleVendorMailCount(ctx, { locationId: shop })).rejects.toMatchObject({ status: 403 });
    expect(reads).toEqual([]);
  });

  it("does not make the list's unfiltered header load", async () => {
    const { ctx, reads } = setup(ROWS());
    await staleVendorMailCount(ctx, { locationId: shop });
    expect(reads.filter((r) => r.table === "vendor_mail_read")).toHaveLength(1);
  });
});

describe("T-D3: the signal reaches every read, the authorization reads included", () => {
  it("with a signal: users, memberships and the list all carry it", async () => {
    const { ctx, reads } = setup(ROWS());
    const controller = new AbortController();
    await staleVendorMailCount(ctx, { locationId: shop }, { signal: controller.signal });
    expect(reads.map((r) => r.table)).toEqual(["users", "user_locations", "vendor_mail_read"]);
    expect(reads.every((r) => r.signal !== null)).toBe(true);
  });

  it("an aborted signal: no query is built", async () => {
    const { ctx, reads } = setup(ROWS());
    const controller = new AbortController();
    controller.abort();
    await expect(staleVendorMailCount(ctx, { locationId: shop }, { signal: controller.signal })).rejects.toBeDefined();
    expect(reads).toEqual([]);
  });

  it("without a signal: the plain client (no signal on any read), and listVendorMail is unchanged", async () => {
    const { ctx, reads } = setup(ROWS());
    await staleVendorMailCount(ctx, { locationId: shop });
    await listVendorMail(ctx, { stale: true, locationId: shop });
    expect(reads.every((r) => r.signal === null)).toBe(true);
  });
});
