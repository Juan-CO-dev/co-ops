/**
 * A RECORDING, predicate-aware fake SupabaseClient (nav PR 9). Every query the code under test builds is recorded with
 * its table, operation, selected columns or payload and every builder call in order, so a test can pin the exact reads
 * (table + columns + predicates), count them, and inject `{ data: null, error }` at one real query (`fail`) or make one
 * hang until its signal aborts (`hang`). Filters are really applied to the in-memory rows: eq / neq / is / in / or (on
 * the embedded table, `referencedTable`) / order (a top-level column) / limit / range. `abortSignal(s)` is honoured: an
 * aborted signal rejects the query with an AbortError. Never a real database.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
export type Call = readonly [string, ...unknown[]];
export interface RecordedQuery {
  readonly table: string;
  op: "select" | "update" | "insert";
  columns?: string;
  payload?: unknown;
  readonly calls: Call[];
  signal?: AbortSignal;
  /** Set when the query was executed (awaited). */
  executed: boolean;
}
export interface RecordingDb {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  queries: RecordedQuery[];
  /** Return an error to inject `{ data: null, error }` at this query, or null to run it. */
  fail: (q: RecordedQuery) => { message: string } | null;
  /** True to make this query hang until its signal aborts (never resolves without a signal). */
  hang: (q: RecordedQuery) => boolean;
}

/** A query's calls, as a compact string: `eq(active,true) in(role,[…]) order(id) range(0,999)`. */
export function describeCalls(q: RecordedQuery): string {
  return q.calls.map(([name, ...args]) => `${name}(${args.map((a) => JSON.stringify(a)).join(",")})`).join(" ");
}
export const has = (q: RecordedQuery, name: string, ...args: unknown[]) =>
  q.calls.some(([n, ...a]) => n === name && args.every((x, i) => JSON.stringify(x) === JSON.stringify(a[i])));

function abortError(): Error {
  const e = new Error("This operation was aborted");
  e.name = "AbortError";
  return e;
}

/** `location_id.eq.A,location_id.is.null` against one row (the embedded notification). */
function orMatches(expr: string, row: Row | undefined): boolean {
  if (!row) return false;
  return expr.split(",").some((part) => {
    const [col, op, ...rest] = part.split(".");
    const v = rest.join(".");
    if (op === "eq") return String(row[col!]) === v;
    if (op === "is" && v === "null") return row[col!] === null || row[col!] === undefined;
    throw new Error(`recording-supabase: unsupported or() part ${part}`);
  });
}

export function recordingSupabase(tables: Record<string, Row[]>): RecordingDb {
  const db: RecordingDb = { client: null as unknown as SupabaseClient, tables, queries: [], fail: () => null, hang: () => false };

  function from(table: string) {
    const rec: RecordedQuery = { table, op: "select", calls: [], executed: false };
    db.queries.push(rec);
    const filters: Array<(r: Row) => boolean> = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    let window: [number, number] | null = null;
    let single = false;
    const rows = () => (tables[table] ??= []);

    const exec = (): Promise<{ data: unknown; error: { message: string } | null }> => {
      rec.executed = true;
      if (rec.signal?.aborted) return Promise.reject(abortError());
      const injected = db.fail(rec);
      if (db.hang(rec)) {
        return new Promise((_resolve, reject) => {
          rec.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      }
      if (injected) return Promise.resolve({ data: null, error: injected });
      if (rec.op === "insert") {
        const ins = (Array.isArray(rec.payload) ? rec.payload : [rec.payload]) as Row[];
        rows().push(...ins);
        return Promise.resolve({ data: ins, error: null });
      }
      const matched = rows().filter((r) => filters.every((f) => f(r)));
      if (rec.op === "update") {
        for (const r of matched) Object.assign(r, rec.payload as Row);
        return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
      }
      let out = [...matched];
      if (orderBy) {
        const { col, asc } = orderBy;
        out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (window) out = out.slice(window[0], window[1] + 1);
      if (limitN !== null) out = out.slice(0, limitN);
      const data = out.map((r) => ({ ...r }));
      return Promise.resolve({ data: single ? (data[0] ?? null) : data, error: null });
    };

    const q: Record<string, unknown> = {};
    const call = (name: string, fn?: (...a: unknown[]) => void) => (...args: unknown[]) => {
      rec.calls.push([name, ...args]);
      fn?.(...args);
      return q;
    };
    Object.assign(q, {
      select: call("select", (c) => { if (rec.op === "select") rec.columns = String(c ?? "*"); }),
      eq: call("eq", (c, v) => filters.push((r) => r[c as string] === v)),
      neq: call("neq", (c, v) => filters.push((r) => r[c as string] !== v)),
      is: call("is", (c, v) => filters.push((r) => (v === null ? r[c as string] === null || r[c as string] === undefined : r[c as string] === v))),
      in: call("in", (c, vs) => filters.push((r) => (vs as unknown[]).includes(r[c as string]))),
      or: call("or", (expr, opts) => {
        const ref = (opts as { referencedTable?: string } | undefined)?.referencedTable;
        filters.push((r) => orMatches(String(expr), ref ? (r[ref] as Row | undefined) : r));
      }),
      order: call("order", (c, o) => {
        const col = String(c);
        if (!col.includes("(")) orderBy = { col, asc: (o as { ascending?: boolean } | undefined)?.ascending !== false };
      }),
      limit: call("limit", (n) => { limitN = n as number; }),
      range: call("range", (a, b) => { window = [a as number, b as number]; }),
      returns: call("returns"),
      abortSignal: call("abortSignal", (s) => { rec.signal = s as AbortSignal; }),
      update: call("update", (p) => { rec.op = "update"; rec.payload = p; }),
      insert: call("insert", (p) => { rec.op = "insert"; rec.payload = p; }),
      maybeSingle: (...args: unknown[]) => { rec.calls.push(["maybeSingle", ...args]); single = true; return exec(); },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => exec().then(resolve, reject),
    });
    return q;
  }

  db.client = { from, rpc: async () => { throw new Error("recording-supabase: rpc not supported"); } } as unknown as SupabaseClient;
  return db;
}

/** The four session operations of one `requireSession` call (lib/session.ts requireSessionCore), by table, columns and
 *  predicates: the sessions read, the activity touch, the users read and the memberships read. */
export function sessionOps(db: RecordingDb, sessionId = "session-1", userId = "user-1"): RecordedQuery[] {
  return db.queries.filter((q) => isSessionOp(q, sessionId, userId));
}
export function isSessionOp(q: RecordedQuery, sessionId = "session-1", userId = "user-1"): boolean {
  const d = describeCalls(q);
  return (q.table === "sessions" && q.op === "select" && q.columns === "*" && d === `select("*") eq("id","${sessionId}") maybeSingle()`)
    || (q.table === "sessions" && q.op === "update" && JSON.stringify(Object.keys(q.payload as object)) === `["last_activity_at"]`
      && d.endsWith(`eq("id","${sessionId}")`) && q.calls.length === 2)
    || (q.table === "users" && q.op === "select" && d === `select("*") eq("id","${userId}") maybeSingle()`)
    || (q.table === "user_locations" && q.op === "select" && d === `select("location_id") eq("user_id","${userId}") eq("active",true)`);
}
/** The baseline: exactly the four session operations, in requireSessionCore's order. */
export const SESSION_BASELINE = ["sessions:select", "sessions:update", "users:select", "user_locations:select"] as const;
