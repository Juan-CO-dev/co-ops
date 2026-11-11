import { vi } from "vitest";

/** A table-aware fake of the service-role client for the catering inbox runtime proofs. Reads filter rows in memory;
 *  writes exist ONLY as `rpc` — a direct insert/update/delete is not implemented and fails loudly. */
export type Row = Record<string, unknown>;
export interface FakeServiceOptions {
  tables?: Record<string, Row[]>;
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null };
}
export function fakeInboxService(options: FakeServiceOptions = {}) {
  const tables = options.tables ?? {};
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => options.rpc ? options.rpc(name, args) : { data: null, error: { message: `unexpected rpc ${name}` } });
  const from = vi.fn((table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let first = 0, last = Infinity, single = false, limit = Infinity;
    const query: Record<string, unknown> = {};
    const chain = (fn?: () => void) => (...args: unknown[]) => { fn?.(); void args; return query; };
    query.select = chain();
    query.order = chain();
    query.returns = chain();
    query.eq = (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; };
    query.neq = (key: string, value: unknown) => { filters.push(row => row[key] !== value); return query; };
    query.in = (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; };
    query.gte = (key: string, value: string) => { filters.push(row => String(row[key]) >= value); return query; };
    query.is = (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return query; };
    query.not = (key: string, _op: string, value: unknown) => { filters.push(row => (row[key] ?? null) !== value); return query; };
    query.ilike = (key: string, value: string) => { filters.push(row => String(row[key]).toLowerCase() === value.toLowerCase()); return query; };
    query.limit = (n: number) => { limit = n; return query; };
    query.range = (a: number, b: number) => { first = a; last = b; return query; };
    query.single = query.maybeSingle = () => { single = true; return query; };
    query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      const rows = (tables[table] ?? []).filter(row => filters.every(f => f(row))).slice(first, Math.min(last + 1, first + limit));
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
    };
    return query;
  });
  return { sb: { from, rpc } as unknown as ReturnType<typeof import("@/lib/supabase-server").getServiceRoleClient>, from, rpc };
}

export const ids = {
  message: "11111111-1111-4111-8111-111111111111", draft: "22222222-2222-4222-8222-222222222222", actor: "33333333-3333-4333-8333-333333333333",
  request: "44444444-4444-4444-8444-444444444444", escalation: "55555555-5555-4555-8555-555555555555", assignee: "66666666-6666-4666-8666-666666666666",
};
export const liveEnv = { CATERING_INBOX_DELIVERY_ENABLED: "1", CATERING_INBOX_FROM: "Catering <catering@example.test>", EMAIL_FROM_TEAM: "team@example.test", RESEND_API_KEY: "re_test",
  EMAIL_FROM: "catering@example.test", NEXT_PUBLIC_APP_URL: "https://staff.example.test", STAFF_ORIGIN: "https://staff.example.test" };

/** What 0298's claim returns for a reply attempt. */
export function claimReply(attempt = 1, extra: Record<string, unknown> = {}) {
  return { message_id: ids.message, revision: 2, replayed: false, draft_id: ids.draft, kind: "reply", attempt, token: "token-1", recipient: "guest@example.test",
    idempotency_key: `catering-inbox:${ids.draft}:${attempt}`, language: "en", template_key: "intake", template_version: "1",
    params: { portalUrl: "https://portal.example.test/order/start", tenantName: "Synthetic", channel: "provider", status: "received" },
    preview_text: "Hi there,\n\nStart your catering request.\n\nhttps://portal.example.test/order/start", subject: "Need catering",
    message_id_header: "<inbound-1@example.test>", references_header: "<root@example.test>", ...extra };
}
export function claimEscalation(attempt = 1, extra: Record<string, unknown> = {}) {
  return { message_id: ids.escalation, revision: 2, replayed: false, draft_id: "77777777-7777-4777-8777-777777777777", kind: "escalation", attempt, token: "token-e",
    recipient: "keith@example.test", idempotency_key: `catering-inbox:77777777-7777-4777-8777-777777777777:${attempt}`, language: "es", template_key: "escalation",
    params: { tenantName: "Synthetic", reason: "urgent" }, preview_text: "Un mensaje de catering necesita una persona.", subject: "Urgente", message_id_header: null, references_header: null, ...extra };
}
