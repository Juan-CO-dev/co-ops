/**
 * A small PREDICATE-AWARE fake SupabaseClient (catalog Phase 1, Astra r1 P2-5). Every filter
 * the code under test applies is really applied to the in-memory rows — a write scoped by
 * .eq("recipe_id", …) genuinely misses a row on another recipe — and every write records how
 * many rows it matched. Chains: select / eq / is / in / not(col, "is", null) / gt (ISO
 * timestamps only) / order / limit / range / returns / maybeSingle / then, insert(…)…,
 * update(…)….  `failUpdates = n` makes the next n updates return an error without applying.
 * Never a real database. (tests/vault-fake-client.ts is the vault's own, richer twin.)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
export interface FakeWrite { table: string; op: "insert" | "update"; payload: unknown; matched: number }
export interface FakeDb {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  writes: FakeWrite[];
  failUpdates: number;
}
type Result = { data: Row[] | null; error: { message: string } | null };

let seq = 0;
const isNull = (v: unknown) => v === null || v === undefined;

export function fakeSupabase(tables: Record<string, Row[]>): FakeDb {
  const db: FakeDb = { client: null as unknown as SupabaseClient, tables, writes: [], failUpdates: 0 };

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: unknown = null;
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    let window: [number, number] | null = null;
    const rows = () => (tables[table] ??= []);

    const run = (): Result => {
      if (op === "insert") {
        const inserted = ((Array.isArray(payload) ? payload : [payload]) as Row[]).map((p) => ({ id: `${table}-${++seq}`, ...p }));
        rows().push(...inserted);
        db.writes.push({ table, op, payload, matched: inserted.length });
        return { data: inserted.map((r) => ({ ...r })), error: null };
      }
      const matched = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        if (db.failUpdates > 0) {
          db.failUpdates -= 1;
          db.writes.push({ table, op, payload, matched: 0 });
          return { data: null, error: { message: "fake update failure" } };
        }
        for (const r of matched) Object.assign(r, payload as Row);
        db.writes.push({ table, op, payload, matched: matched.length });
        return { data: matched.map((r) => ({ ...r })), error: null };
      }
      let out = [...matched];
      if (orderBy) {
        const { col, asc } = orderBy;
        out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (window) out = out.slice(window[0], window[1] + 1);
      if (limitN !== null) out = out.slice(0, limitN);
      return { data: out.map((r) => ({ ...r })), error: null };
    };

    const q = {
      select: (_columns?: string) => q,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: null | boolean) => { filters.push((r) => (v === null ? isNull(r[c]) : r[c] === v)); return q; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      not: (c: string, operator: string, v: unknown) => {
        if (operator !== "is" || v !== null) throw new Error(`fake-supabase: unsupported not(${c}, ${operator})`);
        filters.push((r) => !isNull(r[c]));
        return q;
      },
      gt: (c: string, v: string) => { filters.push((r) => !isNull(r[c]) && String(r[c]) > v); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { orderBy = { col: c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { limitN = n; return q; },
      range: (a: number, b: number) => { window = [a, b]; return q; },
      returns: () => q,
      insert: (p: unknown) => { op = "insert"; payload = p; return q; },
      update: (p: unknown) => { op = "update"; payload = p; return q; },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  }

  db.client = { from } as unknown as SupabaseClient;
  return db;
}
