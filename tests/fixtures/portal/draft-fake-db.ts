/**
 * A small in-memory fake of the service-role client, shaped for lib/portal/draft.ts (audit W01).
 * Filters are really applied, writes really land, and `update(…, { count: "exact" })` reports the
 * matched count, so a guarded write that misses (status moved, row gone) is visible to the code
 * under test. Deleting catering_quote_items cascades to catering_quote_item_options (0144).
 *
 * `rpc(name)` with no fake registered answers PostgREST's "function not found" (PGRST202): that IS
 * the database before migration 0302 is applied, so the legacy path is what runs by default.
 * Never a real database.
 */
export type Row = Record<string, unknown>;
export interface FakeWrite { table: string; op: "insert" | "update" | "delete"; payload: unknown; matched: number }
export type FakeRpc = (args: Record<string, unknown>, db: DraftFakeDb) => { data: unknown; error: { code?: string; message: string } | null };
export interface DraftFakeDb {
  client: unknown;
  tables: Record<string, Row[]>;
  writes: FakeWrite[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  /** Make the next write to `table` (insert/update/delete) fail with an error, once. */
  failNext: Array<{ table: string; op: "insert" | "update" | "delete" }>;
  /** Called before every write is applied (lets a test interleave a concurrent change). */
  beforeWrite?: (w: { table: string; op: string; payload: unknown }) => void;
}

let seq = 0;

export function draftFakeDb(tables: Record<string, Row[]>, rpcs: Record<string, FakeRpc> = {}): DraftFakeDb {
  const db: DraftFakeDb = { client: null, tables, writes: [], rpcCalls: [], failNext: [] };

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: unknown = null;
    let wantCount = false;
    let orderBy: { col: string; asc: boolean } | null = null;
    const rows = () => (tables[table] ??= []);

    const failing = (): boolean => {
      const i = db.failNext.findIndex((f) => f.table === table && f.op === op);
      if (i < 0) return false;
      db.failNext.splice(i, 1);
      return true;
    };

    const run = (): { data: Row[] | null; error: { message: string; code?: string } | null; count?: number | null } => {
      if (op !== "select") db.beforeWrite?.({ table, op, payload });
      if (op !== "select" && failing()) {
        db.writes.push({ table, op, payload, matched: 0 });
        return { data: null, error: { message: `fake ${op} failure on ${table}` }, count: null };
      }
      if (op === "insert") {
        const inserted = ((Array.isArray(payload) ? payload : [payload]) as Row[]).map((p) => ({ id: `${table}-${++seq}`, ...p }));
        rows().push(...inserted);
        db.writes.push({ table, op, payload, matched: inserted.length });
        return { data: inserted.map((r) => ({ ...r })), error: null, count: inserted.length };
      }
      const matched = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of matched) Object.assign(r, payload as Row);
        db.writes.push({ table, op, payload, matched: matched.length });
        return { data: matched.map((r) => ({ ...r })), error: null, count: wantCount ? matched.length : null };
      }
      if (op === "delete") {
        tables[table] = rows().filter((r) => !matched.includes(r));
        if (table === "catering_quote_items") {
          const gone = new Set(matched.map((r) => r.id));
          tables.catering_quote_item_options = (tables.catering_quote_item_options ?? []).filter((o) => !gone.has(o.quote_item_id));
        }
        db.writes.push({ table, op, payload: null, matched: matched.length });
        return { data: null, error: null, count: wantCount ? matched.length : null };
      }
      let out = [...matched];
      if (orderBy) {
        const { col, asc } = orderBy;
        out.sort((a, b) => (Number(a[col]) - Number(b[col])) * (asc ? 1 : -1));
      }
      return { data: out.map((r) => ({ ...r })), error: null, count: out.length };
    };

    const q = {
      select: (_cols?: string, o?: { count?: string }) => { if (o?.count) wantCount = true; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: null) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { orderBy = { col: c, asc: o?.ascending !== false }; return q; },
      limit: () => q,
      returns: () => q,
      insert: (p: unknown) => { op = "insert"; payload = p; return q; },
      update: (p: unknown, o?: { count?: string }) => { op = "update"; payload = p; if (o?.count) wantCount = true; return q; },
      delete: (o?: { count?: string }) => { op = "delete"; if (o?.count) wantCount = true; return q; },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      single: async () => {
        const r = run();
        if (r.error) return { data: null, error: r.error };
        if (!r.data || r.data.length !== 1) return { data: null, error: { message: "not exactly one row", code: "PGRST116" } };
        return { data: r.data[0], error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  }

  const rpc = async (name: string, args: Record<string, unknown>) => {
    db.rpcCalls.push({ name, args });
    const fn = rpcs[name];
    if (!fn) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` } };
    return fn(args, db);
  };
  db.client = { from, rpc };
  return db;
}
