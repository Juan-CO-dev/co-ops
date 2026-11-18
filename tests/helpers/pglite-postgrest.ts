// A minimal PostgREST-shaped client over PGlite, for end-to-end tests that must run a loader's REAL reads against
// the REAL schema (board two views PR 1). It speaks only what those reads use:
//   from(table).select("a,b").eq().in().gte().lte().order().range()   -> rows (dates as YYYY-MM-DD, instants as ISO)
//   rpc(fn, namedArgs)                                                 -> rows for a set-returning function, else the scalar
// A column or function that does not exist is the database's own error, returned as { error: { code, message } }
// exactly where PostgREST would (so a loader query naming a missing column fails the test).
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

type Answer = { data: unknown; error: { code?: string; message: string } | null };
export interface PgliteClientOpts {
  /** RPCs the database does not have (e.g. sales_report_daily): answered here instead. */
  rpc?: Record<string, (args: Record<string, unknown>) => Answer | Promise<Answer>>;
  /** Every call, in order. */
  calls?: Array<{ kind: "rpc" | "from"; name: string; args?: Record<string, unknown> }>;
}

const DATE_OID = 1082, TIMESTAMPTZ_OID = 1184;
function plain(v: unknown, oid: number): unknown {
  if (v instanceof Date) return oid === DATE_OID ? v.toISOString().slice(0, 10) : v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (oid === TIMESTAMPTZ_OID && typeof v === "string") return new Date(v).toISOString();
  return v;
}
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`pglite-postgrest: bad identifier ${s}`);
  return `"${s}"`;
};
const fail = (e: unknown): Answer => {
  const err = e as { code?: string; message?: string };
  // 42883 = no such function (PostgREST answers PGRST202 for an unknown RPC; loaders accept either).
  return { data: null, error: { code: err.code, message: String(err.message ?? e) } };
};

export function pgliteClient(db: PGlite, opts: PgliteClientOpts = {}): SupabaseClient {
  const run = async (sql: string, params: unknown[]): Promise<Answer> => {
    try {
      const r = await db.query<Record<string, unknown>>(sql, params);
      const oid = new Map(r.fields.map((f) => [f.name, f.dataTypeID]));
      return { data: r.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v, oid.get(k) ?? 0)]))), error: null };
    } catch (e) {
      if (db.isInTransaction()) await db.exec("rollback");
      return fail(e);
    }
  };
  const client = {
    from(table: string) {
      opts.calls?.push({ kind: "from", name: table });
      let cols = "*";
      const where: string[] = [];
      const params: unknown[] = [];
      const order: string[] = [];
      let lo = 0, hi: number | null = null;
      const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const q: Record<string, unknown> = {
        select: (c: string) => { cols = c.split(",").map((x) => ident(x.trim())).join(", "); return q; },
        eq: (c: string, v: unknown) => { where.push(`${ident(c)} = ${p(v)}`); return q; },
        in: (c: string, v: unknown[]) => { where.push(v.length ? `${ident(c)} in (${v.map(p).join(", ")})` : "false"); return q; },
        gte: (c: string, v: unknown) => { where.push(`${ident(c)} >= ${p(v)}`); return q; },
        lte: (c: string, v: unknown) => { where.push(`${ident(c)} <= ${p(v)}`); return q; },
        order: (c: string, o?: { ascending?: boolean }) => { order.push(`${ident(c)} ${o?.ascending === false ? "desc" : "asc"}`); return q; },
        range: (a: number, z: number) => { lo = a; hi = z; return q; },
        then: (res: (v: Answer) => unknown, rej?: (e: unknown) => unknown) => run(
          `select ${cols} from public.${ident(table)}${where.length ? ` where ${where.join(" and ")}` : ""}${order.length ? ` order by ${order.join(", ")}` : ""}`
          + `${hi === null ? "" : ` limit ${hi - lo + 1}`} offset ${lo}`, params).then(res, rej),
      };
      return q;
    },
    rpc(fn: string, args: Record<string, unknown> = {}) {
      opts.calls?.push({ kind: "rpc", name: fn, args });
      const answer = async (): Promise<Answer> => {
        if (opts.rpc?.[fn]) return opts.rpc[fn]!(args);
        const names = Object.keys(args);
        const params = names.map((n) => (args[n] !== null && typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n]));
        const call = `public.${ident(fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(", ")})`;
        let retset: boolean;
        try {
          retset = (await db.query<{ proretset: boolean }>("select proretset from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [fn])).rows[0]?.proretset ?? false;
        } catch (e) { return fail(e); }
        const r = await run(`select * from ${call}`, params);
        if (r.error || retset) return r;
        const first = (r.data as Record<string, unknown>[])[0];
        return { data: first ? Object.values(first)[0] : null, error: null };
      };
      const b = {
        abortSignal: () => b,
        then: (res: (v: Answer) => unknown, rej?: (e: unknown) => unknown) => answer().then(res, rej),
      };
      return b;
    },
  };
  return client as unknown as SupabaseClient;
}
