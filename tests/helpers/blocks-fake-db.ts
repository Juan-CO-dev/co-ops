// Nav PR 8: one fake PostgREST client for the role blocks' readers (the strip, "Needs you", the catering block's extras).
// Every request is recorded (table or RPC, its filters, the signal it carried, its range); a table or RPC can answer at
// once, hang until its signal aborts (then answer, the worst case: a response landing as the abort does), reject after a
// delay, or return an error. Filters eq / in / is / gte / lte / neq apply; anything else is recorded and passes.
type Row = Record<string, unknown>;
export interface BlocksCall { kind: "table" | "rpc"; name: string; filters: string[]; signal: AbortSignal | null; range: [number, number] | null; head: boolean }
export interface Behavior { hang?: boolean; rejectAfterMs?: number; error?: { code: string; message: string } }
export interface BlocksDbState {
  calls: BlocksCall[];
  tables: Record<string, Row[]>;
  rpcs: Record<string, (args: Record<string, unknown>) => unknown>;
  behave: Record<string, Behavior>;
}
export function blocksState(): BlocksDbState {
  return { calls: [], tables: {}, rpcs: {}, behave: {} };
}

function settleCall<T>(call: BlocksCall, b: Behavior | undefined, answer: () => T): Promise<T> {
  if (b?.rejectAfterMs !== undefined) return new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${call.name} rejected`)), b.rejectAfterMs));
  if (b?.hang) {
    return new Promise<T>((resolve) => {
      const go = () => resolve(answer());
      if (call.signal?.aborted) return go();
      call.signal?.addEventListener("abort", go);
    });
  }
  return Promise.resolve().then(answer);
}

const FILTERS = new Set(["eq", "in", "is", "gte", "lte", "neq"]);
function match(method: string, key: string, value: unknown) {
  return (r: Row) => {
    const v = r[key] ?? null;
    switch (method) {
      case "eq": return v === value;
      case "neq": return v !== value;
      case "in": return (value as unknown[]).includes(v);
      case "is": return key in r ? v === value : value === null; // an embed filter (`is(relation, null)`) passes
      case "gte": return String(v) >= String(value);
      case "lte": return String(v) <= String(value);
      default: return true;
    }
  };
}

export function blocksClient(state: BlocksDbState) {
  const builder = (call: BlocksCall, rows: () => unknown) => {
    const preds: Array<(r: Row) => boolean> = [];
    let single = false;
    let exact = false;
    const b: Record<string, unknown> = {};
    const self = new Proxy(b, {
      get(_t, prop: string) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            const behave = state.behave[call.name];
            return settleCall(call, behave, () => {
              if (behave?.error) return { data: null, error: behave.error, count: null };
              const raw = rows();
              if (!Array.isArray(raw)) return { data: raw, error: null, count: null };
              const all = (raw as Row[]).filter((r) => preds.every((p) => p(r)));
              const page = call.range ? all.slice(call.range[0], call.range[1] + 1) : all;
              if (call.head) return { data: null, error: null, count: all.length };
              return { data: single ? page[0] ?? null : page, error: null, count: exact ? all.length : null };
            }).then(res, rej);
          };
        }
        if (prop === "abortSignal") return (s: AbortSignal) => { call.signal = s; return self; };
        if (prop === "select") return (_c?: string, o?: { count?: string; head?: boolean }) => { exact = o?.count === "exact"; call.head = o?.head === true; return self; };
        if (prop === "range") return (a: number, z: number) => { call.range = [a, z]; return self; };
        if (prop === "maybeSingle" || prop === "single") return () => { single = true; return self; };
        return (key?: unknown, value?: unknown) => {
          call.filters.push(`${prop}(${typeof key === "string" ? key : ""})`);
          if (FILTERS.has(prop) && typeof key === "string") preds.push(match(prop, key, value));
          return self;
        };
      },
    });
    return self;
  };
  return {
    from(table: string) {
      const call: BlocksCall = { kind: "table", name: table, filters: [], signal: null, range: null, head: false };
      state.calls.push(call);
      return builder(call, () => state.tables[table] ?? []);
    },
    rpc(fn: string, args: Record<string, unknown>, opts?: { count?: string }) {
      const call: BlocksCall = { kind: "rpc", name: fn, filters: [], signal: null, range: null, head: false };
      state.calls.push(call);
      const b = builder(call, () => state.rpcs[fn]?.(args) ?? null) as Record<string, unknown>;
      if (opts?.count === "exact") (b.select as (c: string, o: { count: string }) => unknown)("*", { count: "exact" });
      return b;
    },
  };
}

/** `kind:name` per request, sorted, for a budget assertion. */
export function callNames(calls: readonly BlocksCall[]): string[] {
  return calls.map((c) => `${c.kind}:${c.name}`).sort();
}
export function countBy(calls: readonly BlocksCall[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of callNames(calls)) out[n] = (out[n] ?? 0) + 1;
  return out;
}
