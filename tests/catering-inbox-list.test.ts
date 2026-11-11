import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { listCateringInbox } from "@/lib/catering/inbox";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const actorId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const received = "2026-11-10T12:00:00.000Z";
function child(id: string, extra: Row = {}): Row {
  return { id, inbound_message_id: `inbound-${id}`, location_id: "shop", sender_address: "guest@example.com", subject: id,
    received_at: received, disposition: "needs_human", classification: "unclassified", identity_status: "resolved",
    reason: null, assigned_to: null, revision: 2, ...extra };
}
function transport(id: string, extra: Row = {}): Row {
  return { id, location_id: "shop", from_address: "guest@example.com", subject: id, received_at: received,
    lane: "catering", content_state: "pending", ...extra };
}
function setup(children: Row[], transports: Row[] = [], role = "catering_mgr") {
  const tables: Record<string, Row[]> = {
    users: [{ id: actorId, name: "Reader", role, active: true }],
    user_locations: [{ user_id: actorId, location_id: "shop", active: true }],
    catering_inbound_messages: children, inbound_messages: transports,
    catering_inbox_settings: [{ singleton: true, mode: "shadow" }],
  };
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  client.mockReturnValue({ from: (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let first = 0; let last = Infinity; let single = false;
    const query: Record<string, unknown> = {};
    const record = (method: string, args: unknown[]) => calls.push({ table, method, args });
    query.select = (...args: unknown[]) => { record("select", args); return query; };
    query.eq = (key: string, value: unknown) => { filters.push(row => row[key] === value); record("eq", [key, value]); return query; };
    query.in = (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); record("in", [key, values]); return query; };
    query.is = (key: string, value: unknown) => {
      filters.push(row => key === "catering_inbound_messages" ? !children.some(c => c.inbound_message_id === row.id) : row[key] === value);
      record("is", [key, value]); return query;
    };
    query.order = () => query;
    query.range = (from: number, to: number) => { first = from; last = to; record("range", [from, to]); return query; };
    query.single = query.maybeSingle = () => { single = true; return query; };
    query.then = (resolve: (value: unknown) => unknown) => {
      const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(first, last + 1);
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
    };
    return query;
  } });
  const ctx = { user: { id: actorId, role, active: true }, session: { id: "session" } } as unknown as AuthContext;
  return { ctx, calls };
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z")); });
afterEach(() => vi.useRealTimers());
describe("real catering inbox list", () => {
  it("groups dispositions, sorts urgent first then oldest and marks only older than 24h stale", async () => {
    const { ctx } = setup([
      child("new", { received_at: "2026-11-11T10:00:00.000Z", disposition: "drafted" }),
      child("old", { received_at: "2026-11-09T10:00:00.000Z", identity_status: "ambiguous" }),
      child("urgent", { received_at: "2026-11-11T11:00:00.000Z", reason: "urgent" }),
      child("handled", { disposition: "handled" }), child("notice", { disposition: "notification" }), child("noise", { disposition: "noise" }),
    ]);
    const list = await listCateringInbox(ctx);
    expect(list.messages.slice(0, 2).map(row => row.id)).toEqual(["urgent", "old"]);
    expect(Object.fromEntries(list.messages.map(row => [row.id, row.group]))).toEqual({ urgent: "needs_reply", old: "needs_reply", handled: "handled", notice: "notifications", noise: "noise", new: "drafted" });
    expect(list.messages.filter(row => row.stale).map(row => row.id)).toEqual(["old"]);
    expect(list.mode).toBe("shadow");
  });
  it("includes only catering pending/failed/blocked_config transports with no child", async () => {
    const { ctx, calls } = setup([child("existing")], [transport("pending"), transport("failed", { content_state: "failed" }),
      transport("config", { content_state: "blocked_config" }), transport("inbound-existing"),
      transport("vendor", { lane: "vendor_receipt" }), transport("fetched", { content_state: "fetched" })]);
    const list = await listCateringInbox(ctx);
    expect(list.messages.filter(row => row.transport_only).map(row => row.id)).toEqual(["transport:pending", "transport:failed", "transport:config"]);
    expect(list.messages.filter(row => row.transport_only).every(row => row.group === "needs_reply" && row.revision === 0)).toBe(true);
    expect(calls).toContainEqual({ table: "inbound_messages", method: "is", args: ["catering_inbound_messages", null] });
  });
  it("filters a requested assignee and keeps transports only in unassigned", async () => {
    const rows = [child("mine", { assigned_to: actorId }), child("other", { assigned_to: otherId }), child("none")];
    const { ctx } = setup(rows, [transport("pending")]);
    expect((await listCateringInbox(ctx, actorId)).messages.map(row => row.id)).toEqual(["mine"]);
    expect((await listCateringInbox(ctx, "unassigned")).messages.map(row => row.id)).toEqual(["none", "transport:pending"]);
  });
  it("scopes GM children and transports to fresh memberships and refuses null-location rows", async () => {
    const { ctx, calls } = setup([child("own"), child("other", { location_id: "other" }), child("global", { location_id: null })],
      [transport("own"), transport("other", { location_id: "other" }), transport("global", { location_id: null })], "gm");
    expect((await listCateringInbox(ctx)).messages.map(row => row.id)).toEqual(["own", "transport:own"]);
    for (const table of ["catering_inbound_messages", "inbound_messages"]) expect(calls).toContainEqual({ table, method: "in", args: ["location_id", ["shop"]] });
  });
  it("pages beyond 1000 children and transports without losing or duplicating evidence", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => child(`child-${i}`));
    const pending = Array.from({ length: 1001 }, (_, i) => transport(`pending-${i}`));
    pending.push(transport("inbound-child-1000"));
    const { ctx, calls } = setup(rows, pending);
    const list = await listCateringInbox(ctx);
    expect(list.messages).toHaveLength(2002);
    expect(list.messages.some(row => row.id === "child-1000")).toBe(true);
    expect(list.messages.some(row => row.id === "transport:pending-1000")).toBe(true);
    for (const table of ["catering_inbound_messages", "inbound_messages"]) expect(calls).toContainEqual({ table, method: "range", args: [1000, 1999] });
  });
});
