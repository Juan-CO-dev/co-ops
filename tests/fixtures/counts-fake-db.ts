/**
 * In-memory PostgREST stand-in for the Counts read path (B9 equivalence + budget tests).
 *
 * Supports exactly the builder surface lib/counts.ts, lib/products.ts, lib/prep-consumption.ts
 * and lib/toast/effective-depletion.ts use: select (with many-to-one `rel!fk!inner(cols)`
 * embeds and dotted filters on them), eq / is / not-is / in / gt / gte / lt / lte / or,
 * order (stable, NULLS LAST asc / FIRST desc), range / limit / maybeSingle, upsert.
 *
 * Timestamps compare as INSTANTS (microsecond precision, any offset spelling) — the way
 * Postgres compares timestamptz — so a "Z" anchor against a "+00:00" ledger row behaves
 * as it does in production. Every awaited query is one ROUND TRIP in `log`.
 */
import type { getServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

/** Many-to-one embeds the read path uses: `<base>.<rel>` → the related table + join keys. */
const RELATIONS: Record<string, { table: string; local: string; foreign: string }> = {
  "vendor_delivery_items.vendor_deliveries": { table: "vendor_deliveries", local: "delivery_id", foreign: "id" },
  "vendor_deliveries.vendors": { table: "vendors", local: "vendor_id", foreign: "id" },
  "production_inputs.productions": { table: "productions", local: "production_id", foreign: "id" },
  "sku_count_lines.sku_count_events": { table: "sku_count_events", local: "count_event_id", foreign: "id" },
  "par_pass_lines.par_pass_events": { table: "par_pass_events", local: "event_id", foreign: "id" },
};

const TS = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;
export function instantMicros(v: string): number {
  const m = TS.exec(v);
  if (!m) return Date.parse(v) * 1000;
  const base = Date.parse(`${m[1]}T${m[2]}${m[4] ?? "Z"}`);
  const frac = (m[3] ?? ".").slice(1).padEnd(6, "0").slice(0, 6);
  return base * 1000 + Number(frac || "0");
}
function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
  const sa = String(a), sb = String(b);
  if (sa.includes("T") || sb.includes("T")) return instantMicros(sa) - instantMicros(sb);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

interface Field { name: string; rel?: { name: string; inner: boolean; fields: Field[] } }
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseSelect(s: string): Field[] {
  return splitTop(s).map((tok) => {
    const open = tok.indexOf("(");
    if (open < 0) return { name: tok };
    const head = tok.slice(0, open).split("!");
    return { name: head[0]!, rel: { name: head[0]!, inner: head.includes("inner"), fields: parseSelect(tok.slice(open + 1, -1)) } };
  });
}

export interface QueryLogEntry { table: string; select: string; depth: number }

/** `latencyMs` makes every round trip take that long (real timers), so a test can read the
 *  CRITICAL PATH — sequential waves — off the wall clock. */
export function createFakeDb(tables: Tables, latencyMs = 0) {
  const log: QueryLogEntry[] = [];
  const writes: Array<{ table: string; rows: Row[] }> = [];
  // CRITICAL PATH: a query issued after a depth-d query has COMPLETED is at least d + 1.
  // With a uniform latency every wave issues and completes together, so `stats.depth` is the
  // number of sequential round-trip waves the caller waited through.
  const stats = { depth: 0 };
  let completedDepth = 0;

  function related(base: string, row: Row, rel: string): Row | null {
    const r = RELATIONS[`${base}.${rel}`];
    if (!r) throw new Error(`fake db: no relation ${base}.${rel}`);
    return (tables[r.table] ?? []).find((x) => x[r.foreign] === row[r.local]) ?? null;
  }
  function project(base: string, row: Row, fields: Field[]): Row | null {
    const out: Row = {};
    for (const f of fields) {
      if (!f.rel) { out[f.name] = f.name === "*" ? undefined : row[f.name]; if (f.name === "*") Object.assign(out, row); continue; }
      const rr = related(base, row, f.rel.name);
      const relTable = RELATIONS[`${base}.${f.rel.name}`]!.table;
      const sub = rr ? project(relTable, rr, f.rel.fields) : null;
      if (f.rel.inner && !sub) return null;
      out[f.rel.name] = sub;
    }
    return out;
  }
  function valueAt(base: string, row: Row, path: string): unknown {
    const parts = path.split(".");
    if (parts.length === 1) return row[path];
    const rr = related(base, row, parts[0]!);
    return rr ? rr[parts.slice(1).join(".")] : undefined;
  }

  function from(table: string) {
    let selectStr = "*";
    const preds: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let rangeFrom: number | null = null, rangeTo: number | null = null, lim: number | null = null;
    let single = false;
    let upsertRows: Row[] | null = null;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};

    let depth = 0;
    const run = () => {
      log.push({ table, select: selectStr, depth });
      if (upsertRows) {
        writes.push({ table, rows: upsertRows });
        const keys = (upsertOpts.onConflict ?? "id").split(",");
        for (const nr of upsertRows) {
          const list = (tables[table] ??= []);
          const hit = list.find((r) => keys.every((k) => r[k] === nr[k]));
          if (hit && !upsertOpts.ignoreDuplicates) Object.assign(hit, nr);
          if (!hit) list.push({ ...nr });
        }
        return { data: null, error: null };
      }
      if (!(table in tables)) return { data: null, error: { message: `relation "${table}" does not exist` } };
      let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      if (orders.length) {
        rows = [...rows].sort((a, b) => {
          for (const o of orders) {
            const va = a[o.col], vb = b[o.col];
            if (va == null && vb == null) continue;
            if (va == null) return o.asc ? 1 : -1;
            if (vb == null) return o.asc ? -1 : 1;
            const c = cmp(va, vb);
            if (c !== 0) return o.asc ? c : -c;
          }
          return 0;
        });
      }
      if (rangeFrom != null) rows = rows.slice(rangeFrom, rangeTo! + 1);
      if (lim != null) rows = rows.slice(0, lim);
      const fields = parseSelect(selectStr);
      const projected = rows.map((r) => project(table, r, fields)).filter((r): r is Row => r !== null);
      if (single) return { data: projected[0] ?? null, error: null };
      return { data: projected, error: null };
    };

    const q = {
      select(cols: string) { selectStr = cols.replace(/\s+/g, " "); return q; },
      eq(col: string, v: unknown) { preds.push((r) => valueAt(table, r, col) === v); return q; },
      neq(col: string, v: unknown) { preds.push((r) => valueAt(table, r, col) !== v); return q; },
      is(col: string, v: unknown) { preds.push((r) => (valueAt(table, r, col) ?? null) === v); return q; },
      not(col: string, op: string, v: unknown) {
        if (op !== "is") throw new Error(`fake db: not.${op}`);
        preds.push((r) => (valueAt(table, r, col) ?? null) !== v); return q;
      },
      in(col: string, vs: unknown[]) { const set = new Set(vs.map(String)); preds.push((r) => set.has(String(valueAt(table, r, col)))); return q; },
      gt(col: string, v: unknown) { preds.push((r) => { const x = valueAt(table, r, col); return x != null && cmp(x, v) > 0; }); return q; },
      gte(col: string, v: unknown) { preds.push((r) => { const x = valueAt(table, r, col); return x != null && cmp(x, v) >= 0; }); return q; },
      lt(col: string, v: unknown) { preds.push((r) => { const x = valueAt(table, r, col); return x != null && cmp(x, v) < 0; }); return q; },
      lte(col: string, v: unknown) { preds.push((r) => { const x = valueAt(table, r, col); return x != null && cmp(x, v) <= 0; }); return q; },
      or(expr: string) {
        const alts = expr.split(",").map((a) => {
          const [col, op, ...rest] = a.split(".");
          const val = rest.join(".");
          if (op === "is" && val === "null") return (r: Row) => (r[col!] ?? null) === null;
          if (op === "eq") return (r: Row) => String(r[col!]) === val;
          throw new Error(`fake db: or ${a}`);
        });
        preds.push((r) => alts.some((f) => f(r))); return q;
      },
      order(col: string, opts?: { ascending?: boolean }) { orders.push({ col, asc: opts?.ascending !== false }); return q; },
      range(a: number, b: number) { rangeFrom = a; rangeTo = b; return q; },
      limit(n: number) { lim = n; return q; },
      returns() { return q; },
      maybeSingle() { single = true; return q; },
      upsert(rows: Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { upsertRows = rows; upsertOpts = opts; return q; },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        depth = completedDepth + 1;
        stats.depth = Math.max(stats.depth, depth);
        const done = <T>(v: T) => { completedDepth = Math.max(completedDepth, depth); return v; };
        const exec = () => { try { return Promise.resolve(run()); } catch (e) { return Promise.reject(e); } };
        const p = latencyMs > 0 ? new Promise<void>((r) => setTimeout(r, latencyMs)).then(exec) : exec();
        return p.then(done, (e) => { done(null); throw e; }).then(resolve, reject);
      },
    };
    return q;
  }
  return { client: { from } as unknown as ReturnType<typeof getServiceRoleClient>, log, writes, stats };
}
