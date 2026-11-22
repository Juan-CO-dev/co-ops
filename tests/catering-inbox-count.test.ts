/**
 * Nav PR 8 (plan r2 2.15, Q6, Q10; T-I1, T-D3): `countCateringInboxWaiting`.
 * - `shop` = the needs-reply rows `listCateringInbox` shows at that shop (the transport rows included), on the same fake;
 * - `unplaced` = the same with no shop, for the catering manager and level 8+; a GM gets null;
 * - `INBOX_NEEDS_REPLY_DISPOSITIONS` = the dispositions `inboxGroup` maps to `needs_reply`;
 * - a missing schema is a 503 (a failed cell); every read, the reader's own included, carries the signal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { countCateringInboxWaiting, listCateringInbox } from "@/lib/catering/inbox";
import { INBOX_DISPOSITIONS, INBOX_NEEDS_REPLY_DISPOSITIONS, inboxGroup } from "@/lib/catering/inbox-shared";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const me = "11111111-1111-4111-8111-111111111111";
const SHOP = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const received = "2026-11-10T12:00:00.000Z";
const child = (id: string, extra: Row = {}): Row => ({ id, inbound_message_id: `inbound-${id}`, location_id: SHOP, sender_address: "g@example.com", subject: id,
  received_at: received, disposition: "needs_human", classification: "unclassified", identity_status: "resolved", reason: null, assigned_to: null, revision: 1, ...extra });
const transport = (id: string, extra: Row = {}): Row => ({ id, location_id: SHOP, from_address: "g@example.com", subject: id, received_at: received, lane: "catering", content_state: "pending", ...extra });

function setup(role: string, children: Row[], transports: Row[], o: { memberships?: string[]; missing?: string } = {}) {
  const tables: Record<string, Row[]> = {
    users: [{ id: me, name: "Reader", role, active: true }],
    user_locations: (o.memberships ?? [SHOP]).map((location_id) => ({ user_id: me, location_id, active: true })),
    catering_inbound_messages: children, inbound_messages: transports,
    catering_inbox_settings: [{ singleton: true, mode: "shadow" }], catering_inbox_drafts: [],
  };
  const reads: Array<{ table: string; head: boolean; signal: AbortSignal | null }> = [];
  client.mockImplementation(() => ({ from: (table: string) => {
    const read = { table, head: false, signal: null as AbortSignal | null };
    reads.push(read);
    const filters: Array<(row: Row) => boolean> = [];
    let first = 0; let last = Infinity; let single = false;
    const q: Record<string, unknown> = {};
    q.select = (_cols: string, opts?: { head?: boolean }) => { read.head = opts?.head === true; return q; };
    q.eq = (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; };
    q.in = (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; };
    q.is = (k: string, v: unknown) => {
      filters.push((r) => (k === "catering_inbound_messages" ? !children.some((c) => c.inbound_message_id === r.id) : (r[k] ?? null) === v)); return q;
    };
    q.order = () => q;
    q.range = (a: number, b: number) => { first = a; last = b; return q; };
    q.single = q.maybeSingle = () => { single = true; return q; };
    q.abortSignal = (s: AbortSignal) => { read.signal = s; return q; };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (table === o.missing) return Promise.resolve(resolve({ data: null, count: null, error: { code: "42P01", message: "missing" } }));
      const all = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (read.head) return Promise.resolve({ data: null, count: all.length, error: null }).then(resolve);
      const rows = all.slice(first, last + 1);
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
    };
    return q;
  } }));
  return { ctx: { user: { id: me, role, active: true }, session: { id: "s" } } as unknown as AuthContext, reads };
}
const CHILDREN = () => [
  child("a"), child("b", { disposition: "recorded" }), child("c", { disposition: "drafted" }), child("d", { disposition: "handled" }),
  child("e", { disposition: "notification" }), child("f", { disposition: "noise" }),
  child("g", { location_id: OTHER }), child("h", { location_id: null }), child("i", { location_id: null, disposition: "handled" }),
];
const TRANSPORTS = () => [
  transport("t1"), transport("t2", { content_state: "failed" }), transport("t3", { content_state: "fetched" }), transport("inbound-a"),
  transport("t4", { location_id: null, content_state: "blocked_config" }), transport("t5", { location_id: OTHER }), transport("t6", { lane: "vendor" }),
];
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z")); });
afterEach(() => vi.useRealTimers());

const needsReplyAt = (list: Awaited<ReturnType<typeof listCateringInbox>>, loc: string | null) =>
  list.messages.filter((m) => m.group === "needs_reply" && m.location_id === loc).length;

describe("T-I1: the counts are the list's needs-reply rows", () => {
  it("INBOX_NEEDS_REPLY_DISPOSITIONS = the dispositions inboxGroup maps to needs_reply", () => {
    expect([...INBOX_NEEDS_REPLY_DISPOSITIONS].sort()).toEqual(INBOX_DISPOSITIONS.filter((d) => inboxGroup(d) === "needs_reply").sort());
  });

  it.each(["catering_mgr", "moo", "owner", "cgs"])("%s: shop and unplaced equal the list's", async (role) => {
    const { ctx } = setup(role, CHILDREN(), TRANSPORTS());
    const list = await listCateringInbox(ctx);
    const counts = await countCateringInboxWaiting(ctx, SHOP);
    expect(counts.shop).toBe(needsReplyAt(list, SHOP));
    expect(counts.unplaced).toBe(needsReplyAt(list, null));
    expect(counts).toEqual({ shop: 4, unplaced: 2 }); // a, b, t1, t2 · h, t4
  });

  it("a GM gets the shop's count and no unplaced line", async () => {
    const { ctx } = setup("gm", CHILDREN(), TRANSPORTS());
    const list = await listCateringInbox(ctx);
    expect(await countCateringInboxWaiting(ctx, SHOP)).toEqual({ shop: needsReplyAt(list, SHOP), unplaced: null });
  });

  it("a GM at a shop they do not belong to is refused (403), no count read", async () => {
    const { ctx, reads } = setup("gm", CHILDREN(), TRANSPORTS());
    await expect(countCateringInboxWaiting(ctx, OTHER)).rejects.toMatchObject({ status: 403 });
    expect(reads.filter((r) => r.head)).toEqual([]);
  });

  it("a role outside the inbox is refused before any read", async () => {
    const { ctx, reads } = setup("agm", CHILDREN(), TRANSPORTS());
    await expect(countCateringInboxWaiting(ctx, SHOP)).rejects.toMatchObject({ status: 403 });
    expect(reads).toEqual([]);
  });

  it.each(["catering_inbound_messages", "inbound_messages"])("a missing %s is a 503 (the cell fails), never 0", async (table) => {
    const { ctx } = setup("catering_mgr", CHILDREN(), TRANSPORTS(), { missing: table });
    await expect(countCateringInboxWaiting(ctx, SHOP)).rejects.toMatchObject({ status: 503, code: "inbox_unavailable" });
  });
});

describe("T-D3: the signal reaches every read, the reader's own included", () => {
  it("with a signal: users, memberships and the four counts carry it", async () => {
    const { ctx, reads } = setup("catering_mgr", CHILDREN(), TRANSPORTS());
    await countCateringInboxWaiting(ctx, SHOP, { signal: new AbortController().signal });
    expect(reads.map((r) => r.table).sort()).toEqual(["catering_inbound_messages", "catering_inbound_messages", "inbound_messages", "inbound_messages", "user_locations", "users"]);
    expect(reads.every((r) => r.signal !== null)).toBe(true);
  });
  it("an aborted signal: no query is built", async () => {
    const { ctx, reads } = setup("catering_mgr", CHILDREN(), TRANSPORTS());
    const c = new AbortController(); c.abort();
    await expect(countCateringInboxWaiting(ctx, SHOP, { signal: c.signal })).rejects.toBeDefined();
    expect(reads).toEqual([]);
  });
  it("without a signal: no read carries one, and listCateringInbox is unchanged", async () => {
    const { ctx, reads } = setup("catering_mgr", CHILDREN(), TRANSPORTS());
    await countCateringInboxWaiting(ctx, SHOP);
    await listCateringInbox(ctx);
    expect(reads.every((r) => r.signal === null)).toBe(true);
  });
});
