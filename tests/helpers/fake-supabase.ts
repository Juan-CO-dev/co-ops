/**
 * A small chainable fake of the Supabase JS query builder for unit tests (audit W22).
 *
 * Every `from(table)` call records the chain it was built with (method + args) and resolves,
 * when awaited or terminated (`maybeSingle` / `single` / `returns` / `abortSignal` / `then`), to
 * the value `respond(call)` returns. `rpc(name, args)` is recorded the same way. No network, no
 * env: a test that reaches the real client fails on a missing variable, as vitest.config says.
 */
export interface FakeCall {
  table: string;
  ops: Array<{ op: string; args: unknown[] }>;
  /** The first op that writes (`insert` / `update` / `upsert` / `delete`), or "select". */
  kind: "select" | "insert" | "update" | "upsert" | "delete";
  has(op: string, ...args: unknown[]): boolean;
  arg(op: string, index?: number): unknown;
}

export interface FakeRpc { name: string; args: Record<string, unknown> }

export type Responder = (call: FakeCall) => { data?: unknown; error?: unknown; count?: number | null } | undefined;

export function fakeSupabase(respond: Responder, rpc?: (r: FakeRpc) => { data?: unknown; error?: unknown }) {
  const calls: FakeCall[] = [];
  const rpcs: FakeRpc[] = [];
  const client = {
    from(table: string) {
      const call: FakeCall = {
        table,
        ops: [],
        kind: "select",
        has(op, ...args) {
          return this.ops.some((o) => o.op === op && args.every((a, i) => JSON.stringify(o.args[i]) === JSON.stringify(a)));
        },
        arg(op, index = 0) {
          return this.ops.find((o) => o.op === op)?.args[index];
        },
      };
      calls.push(call);
      const settle = () => {
        const r = respond(call) ?? {};
        return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
      };
      const builder: Record<string, unknown> = {};
      const chain = (op: string) => (...args: unknown[]) => {
        call.ops.push({ op, args });
        if (call.kind === "select" && (op === "insert" || op === "update" || op === "upsert" || op === "delete")) call.kind = op;
        return builder;
      };
      for (const op of ["select", "insert", "update", "upsert", "delete", "eq", "neq", "in", "is", "not", "gt", "gte", "lt", "lte", "or", "order", "limit", "range", "filter", "match", "like", "ilike"]) {
        builder[op] = chain(op);
      }
      const terminal = (op: string) => async (...args: unknown[]) => {
        call.ops.push({ op, args });
        return settle();
      };
      builder.maybeSingle = terminal("maybeSingle");
      builder.single = terminal("single");
      builder.returns = terminal("returns");
      builder.abortSignal = terminal("abortSignal");
      builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(settle()).then(resolve, reject);
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const r: FakeRpc = { name, args };
      rpcs.push(r);
      const out = rpc?.(r) ?? {};
      return { data: out.data ?? null, error: out.error ?? null };
    },
  };
  return { client, calls, rpcs };
}
