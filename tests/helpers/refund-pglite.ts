/**
 * Catering refunds Part B1 v2 — the REAL SQL under the app's own code. A PostgREST-shaped stand-in for the
 * service-role Supabase client, over PGlite carrying the REAL migrations 0357 -> 0358 -> 0359
 * (scripts/sql-harness-0359-lib.mjs `base()`), so lib/catering/refund-observe.ts and lib/catering/refunds.ts run
 * their actual RPCs and reads against the actual functions. SYNTHETIC ROWS ONLY; no network; Stripe is always the
 * HTTP fake the test supplies (tests/stripe-http-fake.ts).
 *
 * It speaks what those modules use:
 *   from(t).select(cols).eq().neq().in().is().not().or().gt().gte().lt().lte().order().limit().range()
 *          .maybeSingle().single().returns().abortSignal()
 *   from(t).insert(row | rows) / .update(patch, { count }) / .delete()  (awaitable; `.select()` after a write returns rows)
 *   rpc(fn, namedArgs).abortSignal()   — objects and arrays go as jsonb; uuid[] parameters are named in `UUID_ARRAY_ARGS`
 * Errors come back as PostgREST gives them: `{ data: null, error: { code, message, details } }` (the SQLSTATE: 42501
 * for a missing grant, 42883 for a missing function, P0001 with the raised NAME as `message` and its DETAIL).
 *
 * `asServiceRole: true` (the default) runs every statement as `service_role`, exactly the app's privileges.
 *
 * ONE STATEMENT AT A TIME. PGlite is one connection; every call (role switch, statement, role reset) runs under one
 * mutex, so two concurrent "presses" interleave BETWEEN calls, exactly as two PostgREST requests would, and never
 * inside one.
 *
 * THE INTERLEAVING HOOK (for tests/catering-refunds-flow.test.ts): `onCall(call)` is awaited BEFORE each call runs
 * (`phase: "before"`) and AFTER it answered (`phase: "after"`, with the answer). A flow test runs a second press, a
 * sweep read or `elapse()` between two RPCs of the first press from there. It runs OUTSIDE the mutex, so the hook may
 * use the same client (or `db` directly) freely.
 */
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

// Plain ESM harness modules: the same base and toolkit the offline harness uses (typed by the casts below).
import * as lib from "../../scripts/sql-harness-0359-lib.mjs";
import * as kit from "../../scripts/sql-harness-0359-kit.mjs";

export const harnessLib = lib as unknown as {
  base(opts?: { upTo?: "base" | "0357" | "0358" | "0359" }): Promise<PGlite>;
  withPartsReady(db: PGlite, opts?: { b2?: string; b3?: string }): Promise<PGlite>;
  one(db: PGlite, sql: string, params?: unknown[]): Promise<Record<string, unknown>>;
  rows(db: PGlite, sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  count(db: PGlite, sql: string, params?: unknown[]): Promise<number>;
  M0359: string;
};

export interface KitPayment { id: string; pi: string; charge: string; amount: number }
export interface KitWorld {
  shop: string;
  other: string;
  user(role: string, opts?: { member?: string | null; active?: boolean; memberActive?: boolean }): Promise<string>;
  quote(loc?: string, root?: string | null): Promise<string>;
  pay(quoteId: string, kind: string, amount: number, opts?: { status?: string; pi?: string; provider?: string; session?: string | null }): Promise<KitPayment>;
}
/* eslint-disable @typescript-eslint/no-explicit-any */
export const harnessKit = kit as unknown as {
  world(db: PGlite): Promise<KitWorld>;
  rpc(db: PGlite, fn: string, args?: unknown[]): Promise<any>;
  asService<T>(db: PGlite, fn: () => Promise<T>): Promise<T>;
  ownerOf(p: KitPayment, opts?: Record<string, unknown>): Record<string, unknown>;
  refundOf(p: KitPayment, amount: number, opts?: Record<string, unknown>): Record<string, unknown>;
  listsOf(refunds: Array<Record<string, unknown>>, opts?: { piTerminal?: boolean; chargeTerminal?: boolean }): unknown[];
  begin(db: PGlite, paymentId: string): Promise<any>;
  read(db: PGlite, p: KitPayment, opts?: Record<string, unknown>): Promise<any>;
  figures(db: PGlite, paymentId: string): Promise<Record<string, any>>;
  elapse(db: PGlite, interval: string): Promise<void>;
  ledger(db: PGlite, ev?: Record<string, unknown>): Promise<string>;
  observing(db: PGlite): Promise<any>;
  backdate(db: PGlite, table: string, column: string, id: string, interval: string, idColumn?: string): Promise<void>;
  requestRow(db: PGlite, id: string): Promise<Record<string, any>>;
  stateRow(db: PGlite, paymentId: string): Promise<Record<string, any> | undefined>;
  mirror(db: PGlite, paymentId: string): Promise<Array<Record<string, any>>>;
  /** probe -> a kit read of every payment the probe named -> ONE reserve (as the fixture owner). */
  press(db: PGlite, opts: {
    actor: string; quoteId: string; amount: number; seen: number; payments: KitPayment[]; token?: string;
    reason?: string; note?: string | null; trigger?: string; readOptions?: (p: KitPayment) => Record<string, unknown>;
  }): Promise<any>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

type Answer = { data: unknown; error: { code?: string; message: string; details?: string } | null; count?: number | null };
export interface RefundCall {
  kind: "rpc" | "select" | "insert" | "update" | "delete";
  name: string;
  args?: unknown;
}
export interface RefundClientOpts {
  /** Every call, in order (table reads / writes and RPC names, with their arguments). */
  calls?: RefundCall[];
  /** RPCs answered by the test instead of the database (e.g. a transport failure). Return undefined to fall through. */
  rpc?: Record<string, (args: Record<string, unknown>) => Answer | undefined | Promise<Answer | undefined>>;
  /** The interleaving hook (see the header). */
  onCall?: (call: RefundCall & { phase: "before" | "after"; answer?: Answer }) => void | Promise<void>;
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
const jsonParam = (v: unknown) => (v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);

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

/** A per-database mutex: one call's role switch + statement + reset at a time. */
const locks = new WeakMap<PGlite, Promise<unknown>>();
function serial<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(db) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(db, next.catch(() => undefined));
  return next;
}

export function refundClient(db: PGlite, opts: RefundClientOpts = {}): SupabaseClient {
  const role = opts.asServiceRole === false ? null : "service_role";
  const run = (sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; affected: number }> =>
    serial(db, async () => {
      if (role) await db.exec(`set role ${role}`);
      try {
        const r = await db.query<Record<string, unknown>>(sql, params);
        return { rows: r.rows.map(rowOut), affected: r.affectedRows ?? r.rows.length };
      } finally {
        if (role) await db.exec("reset role");
      }
    });
  const hooked = async (call: RefundCall, exec: () => Promise<Answer>): Promise<Answer> => {
    opts.calls?.push(call);
    await opts.onCall?.({ ...call, phase: "before" });
    const answer = await exec();
    await opts.onCall?.({ ...call, phase: "after", answer });
    return answer;
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
              const vals = keys.map((k) => p(jsonParam(row[k])));
              const r = await run(`insert into public.${ident(table)} (${keys.map(ident).join(", ")}) values (${vals.join(", ")})${returning ? ` returning ${cols}` : ""}`, params);
              rows.push(...r.rows); affected += r.affected; params.length = 0;
            }
          } else if (mode === "update") {
            const patch = payload as Record<string, unknown>;
            const setParams: unknown[] = [];
            const sets = Object.keys(patch).map((k) => { setParams.push(jsonParam(patch[k])); return `${ident(k)} = $${params.length + setParams.length}`; });
            const r = await run(`update public.${ident(table)} set ${sets.join(", ")}${w}${returning ? ` returning ${cols}` : ""}`, [...params, ...setParams]);
            rows = r.rows; affected = r.affected;
          } else {
            const r = await run(`delete from public.${ident(table)}${w}${returning ? ` returning ${cols}` : ""}`, params);
            rows = r.rows; affected = r.affected;
          }
          const count = wantCount ? (mode === "select" ? rows.length : affected) : null;
          if (single) {
            if (rows.length > 1 || (rows.length === 0 && single === "one")) {
              return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, count };
            }
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
        then: (resolve: (a: Answer) => unknown, reject?: (e: unknown) => unknown) =>
          hooked({ kind: mode, name: table, ...(payload ? { args: payload } : {}) }, exec).then(resolve, reject),
      };
      return q;
    },

    rpc(fn: string, args: Record<string, unknown> = {}) {
      const exec = async (): Promise<Answer> => {
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
          const params = names.map((n) => (UUID_ARRAY_ARGS.has(n) ? args[n] : jsonParam(args[n])));
          const r = await run(`select public.${ident(fn)}(${call}) as result`, params);
          return { data: plain(r.rows[0]?.result) ?? null, error: null };
        } catch (e) {
          return fail(e);
        }
      };
      const q: Record<string, unknown> = {
        abortSignal: () => q,
        then: (resolve: (a: Answer) => unknown, reject?: (e: unknown) => unknown) => hooked({ kind: "rpc", name: fn, args }, exec).then(resolve, reject),
      };
      return q;
    },
  };
  return client as unknown as SupabaseClient;
}

/**
 * Run fixture-owner work on `db` (a kit call, `elapse`, a direct query) under the SAME mutex the client uses, so it
 * never lands between another call's role switch and its statement. Use it for direct `db` work while a lib call may
 * be in flight (inside `onCall`, or beside a concurrent press).
 */
export function withDb<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  return serial(db, fn);
}

/** A database with the REAL 0357 -> 0358 -> 0359. `partsReady` adds the isolated B2 / B3 readiness fixture. */
export async function refundDb(opts: { partsReady?: boolean } = {}): Promise<PGlite> {
  const db = await harnessLib.base();
  if (opts.partsReady) await harnessLib.withPartsReady(db);
  return db;
}
