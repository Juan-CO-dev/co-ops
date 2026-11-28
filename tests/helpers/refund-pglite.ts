/**
 * Catering refunds Part B1 — the REAL SQL under the app's own code. A PostgREST-shaped client over PGlite carrying
 * the REAL migrations 0357 -> 0358 -> 0359 (scripts/sql-harness-0359-lib.mjs), so lib/catering/refunds.ts,
 * lib/catering/refund-reconcile.ts and lib/stripe/webhook.ts run their actual queries and RPCs against the actual
 * functions. SYNTHETIC ROWS ONLY; no network; Stripe is always a fake the test supplies.
 *
 * It speaks what those modules use:
 *   from(t).select(cols).eq().neq().in().is().or().gte().lte().order().limit().range().maybeSingle().single().returns()
 *   from(t).insert(row | rows), .update(patch, { count: "exact" }).eq()…, .delete().eq()…   (awaitable; `.select()` after a write returns the rows)
 *   rpc(fn, namedArgs)   — objects and arrays of objects go as jsonb; uuid[] parameters are named in `UUID_ARRAY_ARGS`
 * Errors come back as PostgREST would give them: `{ data: null, error: { code, message, details } }` — the SQLSTATE
 * (42501 for a withdrawn grant, 42883 for a missing function, P0001 with the raised name as `message`).
 *
 * `asServiceRole: true` (the default) runs every statement as `service_role`, exactly the app's privileges: a query
 * the grants do not allow fails here as it would in production.
 */
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

// Plain ESM harness modules: the same base and toolkit the offline harness uses (typed by the casts below).
import * as lib from "../../scripts/sql-harness-0359-lib.mjs";
import * as kit from "../../scripts/sql-harness-0359-kit.mjs";

export const harnessLib = lib as unknown as {
  base(opts?: { upTo?: "base" | "0357" | "0358" | "0359" }): Promise<PGlite>;
  withStandIns(db: PGlite): Promise<PGlite>;
  one(db: PGlite, sql: string, params?: unknown[]): Promise<Record<string, unknown>>;
  rows(db: PGlite, sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  count(db: PGlite, sql: string, params?: unknown[]): Promise<number>;
  CALLER: string;
  M0359: string;
};
export interface KitWorld {
  shop: string;
  other: string;
  user(role: string, opts?: { member?: string | null; active?: boolean; memberActive?: boolean }): Promise<string>;
  session(userId: string, opts?: { fresh?: boolean; stale?: boolean }): Promise<string>;
  quote(loc?: string, root?: string | null): Promise<string>;
  pay(quoteId: string, kind: string, amount: number, opts?: { status?: string; pi?: string }): Promise<{ id: string; pi: string }>;
}
export const harnessKit = kit as unknown as {
  world(db: PGlite): Promise<KitWorld>;
  goLive(db: PGlite, operator?: string): Promise<{ epoch: string; generation: number }>;
  rpc(db: PGlite, fn: string, args: unknown[]): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  ingest(db: PGlite, ev: Record<string, unknown>): Promise<{ id: string; result?: string; state?: string; floor?: boolean }>;
  figures(db: PGlite, paymentId: string, exclude?: string | null): Promise<Record<string, number | boolean>>;
  backdate(db: PGlite, table: string, column: string, id: string, interval: string, idColumn?: string): Promise<void>;
};

type Answer = { data: unknown; error: { code?: string; message: string; details?: string } | null; count?: number | null };
export interface RefundClientOpts {
  /** Every call, in order (table reads / writes and RPC names): the trace the OFF-parity and zero-call tests read. */
  calls?: Array<{ kind: "rpc" | "select" | "insert" | "update" | "delete"; name: string; args?: unknown }>;
  /** RPCs answered by the test instead of the database (e.g. to inject a failure). Return undefined to fall through. */
  rpc?: Record<string, (args: Record<string, unknown>) => Answer | undefined | Promise<Answer | undefined>>;
  /** Run as service_role (default true). False = the fixture owner. */
  asServiceRole?: boolean;
}

const UUID_ARRAY_ARGS = new Set(["p_quote_ids"]);
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`refund-pglite: bad identifier ${s}`);
  return `"${s}"`;
};
function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  return v;
}
const rowOut = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)]));
const fail = (e: unknown): Answer => {
  const err = e as { code?: string; message?: string; detail?: string };
  return { data: null, error: { code: err.code, message: String(err.message ?? e), details: err.detail } };
};

/** One PostgREST `or=` clause: `col.op.value,col.op.value` (no nesting). */
function orClause(filter: string, p: (v: unknown) => string): string {
  const parts = filter.split(",").map((part) => {
    const m = /^([a-z_][a-z0-9_]*)\.(eq|neq|is|gt|gte|lt|lte)\.(.*)$/.exec(part.trim());
    if (!m) throw new Error(`refund-pglite: unsupported or() part ${part}`);
    const [, col, op, raw] = m as unknown as [string, string, string, string];
    if (op === "is") {
      if (raw !== "null") throw new Error(`refund-pglite: unsupported is.${raw}`);
      return `${ident(col)} is null`;
    }
    const sql = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]!;
    return `${ident(col)}::text ${sql} ${p(raw)}`;
  });
  return `(${parts.join(" or ")})`;
}

export function refundClient(db: PGlite, opts: RefundClientOpts = {}): SupabaseClient {
  const role = opts.asServiceRole === false ? null : "service_role";
  const run = async (sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; affected: number }> => {
    if (role) await db.exec(`set role ${role}`);
    try {
      const r = await db.query<Record<string, unknown>>(sql, params);
      return { rows: r.rows.map(rowOut), affected: r.affectedRows ?? r.rows.length };
    } catch (e) {
      if (db.isInTransaction()) await db.exec("rollback");
      throw e;
    } finally {
      if (role) await db.exec("reset role");
    }
  };

  const client = {
    from(table: string) {
      let mode: "select" | "insert" | "update" | "delete" = "select";
      let cols = "*";
      let payload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
      let wantCount = false;
      let returning = false;
      let single: "maybe" | "one" | null = null;
      const where: string[] = [];
      const params: unknown[] = [];
      const order: string[] = [];
      let limit: number | null = null;
      let offset = 0;
      const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const colList = (c: string) => (c.trim() === "*" ? "*" : c.split(",").map((x) => ident(x.trim())).join(", "));

      const exec = async (): Promise<Answer> => {
        opts.calls?.push({ kind: mode, name: table, ...(payload ? { args: payload } : {}) });
        try {
          const w = where.length ? ` where ${where.join(" and ")}` : "";
          let rows: Array<Record<string, unknown>> = [];
          let affected = 0;
          if (mode === "select") {
            const tail = `${order.length ? ` order by ${order.join(", ")}` : ""}${limit != null ? ` limit ${limit}` : ""}${offset ? ` offset ${offset}` : ""}`;
            ({ rows } = await run(`select ${cols} from public.${ident(table)}${w}${tail}`, params));
          } else if (mode === "insert") {
            const list = Array.isArray(payload) ? payload : [payload!];
            for (const row of list) {
              const keys = Object.keys(row);
              const vals = keys.map((k) => { const v = row[k]; return p(v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v); });
              const r = await run(`insert into public.${ident(table)} (${keys.map(ident).join(", ")}) values (${vals.join(", ")})${returning ? ` returning ${cols}` : ""}`, params);
              rows.push(...r.rows); affected += r.affected; params.length = 0;
            }
          } else if (mode === "update") {
            const patch = payload as Record<string, unknown>;
            // SET placeholders come first in the text but the WHERE params were pushed first: renumber by building fresh.
            const setParams: unknown[] = [];
            const sets = Object.keys(patch).map((k) => { const v = patch[k]; setParams.push(v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v); return `${ident(k)} = $${params.length + setParams.length}`; });
            const r = await run(`update public.${ident(table)} set ${sets.join(", ")}${w}${returning ? ` returning ${cols}` : ""}`, [...params, ...setParams]);
            rows = r.rows; affected = r.affected;
          } else {
            const r = await run(`delete from public.${ident(table)}${w}${returning ? ` returning ${cols}` : ""}`, params);
            rows = r.rows; affected = r.affected;
          }
          const count = wantCount ? (mode === "select" ? rows.length : affected) : null;
          if (single) {
            if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, count };
            if (rows.length === 0 && single === "one") return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, count };
            return { data: rows[0] ?? null, error: null, count };
          }
          return { data: mode === "select" || returning ? rows : null, error: null, count };
        } catch (e) {
          return fail(e);
        }
      };

      const q: Record<string, unknown> = {
        select: (c: string = "*", o?: { count?: string }) => { cols = colList(c); if (mode !== "select") returning = true; if (o?.count) wantCount = true; return q; },
        insert: (v: Record<string, unknown> | Array<Record<string, unknown>>) => { mode = "insert"; payload = v; return q; },
        update: (v: Record<string, unknown>, o?: { count?: string }) => { mode = "update"; payload = v; if (o?.count) wantCount = true; return q; },
        delete: (o?: { count?: string }) => { mode = "delete"; if (o?.count) wantCount = true; return q; },
        eq: (c: string, v: unknown) => { where.push(`${ident(c)} = ${p(v)}`); return q; },
        neq: (c: string, v: unknown) => { where.push(`${ident(c)} <> ${p(v)}`); return q; },
        in: (c: string, v: unknown[]) => { where.push(v.length ? `${ident(c)} in (${v.map(p).join(", ")})` : "false"); return q; },
        is: (c: string, v: unknown) => { if (v !== null) throw new Error("refund-pglite: is() supports null only"); where.push(`${ident(c)} is null`); return q; },
        not: (c: string, op: string, v: unknown) => { if (op !== "is" || v !== null) throw new Error("refund-pglite: not() supports is null only"); where.push(`${ident(c)} is not null`); return q; },
        gte: (c: string, v: unknown) => { where.push(`${ident(c)} >= ${p(v)}`); return q; },
        lte: (c: string, v: unknown) => { where.push(`${ident(c)} <= ${p(v)}`); return q; },
        gt: (c: string, v: unknown) => { where.push(`${ident(c)} > ${p(v)}`); return q; },
        lt: (c: string, v: unknown) => { where.push(`${ident(c)} < ${p(v)}`); return q; },
        or: (f: string) => { where.push(orClause(f, p)); return q; },
        order: (c: string, o?: { ascending?: boolean }) => { order.push(`${ident(c)} ${o?.ascending === false ? "desc" : "asc"}`); return q; },
        limit: (n: number) => { limit = n; return q; },
        range: (a: number, b: number) => { offset = a; limit = b - a + 1; return q; },
        returns: () => q,
        abortSignal: () => q,
        maybeSingle: () => { single = "maybe"; return q; },
        single: () => { single = "one"; return q; },
        then: (resolve: (a: Answer) => unknown, reject?: (e: unknown) => unknown) => exec().then(resolve, reject),
      };
      return q;
    },

    rpc(fn: string, args: Record<string, unknown> = {}) {
      const exec = async (): Promise<Answer> => {
        opts.calls?.push({ kind: "rpc", name: fn, args });
        const override = await opts.rpc?.[fn]?.(args);
        if (override) return override;
        try {
          const names = Object.keys(args);
          const call = names.map((n, i) => {
            const v = args[n];
            if (UUID_ARRAY_ARGS.has(n)) return `${ident(n)} => $${i + 1}::uuid[]`;
            if (v !== null && typeof v === "object") return `${ident(n)} => $${i + 1}::jsonb`;
            return `${ident(n)} => $${i + 1}`;
          }).join(", ");
          const params = names.map((n) => { const v = args[n]; return UUID_ARRAY_ARGS.has(n) ? v : v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
          const r = await run(`select public.${ident(fn)}(${call}) as result`, params);
          return { data: plain(r.rows[0]?.result) ?? null, error: null };
        } catch (e) {
          return fail(e);
        }
      };
      const q: Record<string, unknown> = {
        abortSignal: () => q,
        then: (resolve: (a: Answer) => unknown, reject?: (e: unknown) => unknown) => exec().then(resolve, reject),
      };
      return q;
    },
  };
  return client as unknown as SupabaseClient;
}

/** A database with the REAL 0357 -> 0358 -> 0359 and the isolated fixture's stand-in install records (B2, B3). */
export async function refundDb(opts: { standIns?: boolean } = {}): Promise<PGlite> {
  const db = await harnessLib.base();
  if (opts.standIns !== false) await harnessLib.withStandIns(db);
  return db;
}
