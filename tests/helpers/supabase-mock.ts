/**
 * A tiny service-role client double for route tests (audit wave W07): every PostgREST builder call is recorded,
 * and the answer for a table / function comes from the handlers the test supplies. No network, no Supabase env.
 *
 *   const sb = makeSupabaseMock({
 *     rpc: (fn, args) => ({ data: …, error: null }),
 *     table: (table, ops) => ({ data: …, error: null }),   // `ops` = the chained calls, e.g. ["select", "eq", "maybeSingle"]
 *   });
 *   vi.mocked(getServiceRoleClient).mockReturnValue(sb.client as never);
 *   sb.rpcCalls            → [["auth_reserve_attempt", { p_user: … }], …]
 *   sb.tableCalls          → [{ table: "users", ops: [["select", […]], ["eq", […]], …] }, …]
 *   sb.wrote("users")      → true when an insert / update / upsert / delete was chained on that table
 */
export interface MockAnswer { data?: unknown; error?: { code?: string; message: string } | null; count?: number | null }
export interface TableCall { table: string; ops: Array<[string, unknown[]]> }

const WRITES = new Set(["insert", "update", "upsert", "delete"]);

export function makeSupabaseMock(handlers: {
  rpc?: (fn: string, args: Record<string, unknown>) => MockAnswer | Promise<MockAnswer>;
  table?: (table: string, ops: string[], call: TableCall) => MockAnswer | Promise<MockAnswer>;
}) {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const tableCalls: TableCall[] = [];
  const answer = (a: MockAnswer) => ({ data: a.data ?? null, error: a.error ?? null, count: a.count ?? null });

  function builder(table: string) {
    const call: TableCall = { table, ops: [] };
    tableCalls.push(call);
    const resolve = async () => answer(handlers.table ? await handlers.table(table, call.ops.map((o) => o[0]), call) : {});
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => resolve().then(ok, bad);
        return (...args: unknown[]) => { call.ops.push([prop, args]); return proxy; };
      },
    });
    return proxy;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push([fn, args]);
      return answer(handlers.rpc ? await handlers.rpc(fn, args) : {});
    },
  };
  return {
    client,
    rpcCalls,
    tableCalls,
    rpcNames: () => rpcCalls.map((c) => c[0]),
    wrote: (table: string) => tableCalls.some((c) => c.table === table && c.ops.some((o) => WRITES.has(o[0]))),
  };
}
