/**
 * A small PREDICATE-AWARE fake service client for the catering payment paths (audit wave
 * W02). Same idea as tests/fake-supabase.ts — every filter the code under test applies is
 * really applied to in-memory rows — plus the four things the money paths lean on that the
 * shared fake does not model:
 *
 *   - `count` on a write (`{ count: "exact" }`): the silent-UPDATE law is checked by
 *     rowcount, so a guarded flip that matches nothing must REPORT zero.
 *   - `.single()` after an insert, `.neq()`, and the two-verb `.or()` the ledger stamp uses.
 *   - UNIQUE INDEXES as predicates: `catering_payments_one_due` (0130) and
 *     `catering_payments_one_open_checkout` (0303) are emulated, so a write that would
 *     violate one returns a real `23505` and applies nothing.
 *   - per-table failure injection for reads (`failSelect`) and writes (`failUpdate`,
 *     `failInsert`), each consumed once per listed entry.
 *   - `rpc()`: migration 0303's `catering_payment_attach_checkout` (review r3). OFF by
 *     default — the call answers PGRST202, exactly what PostgREST says for a function that
 *     does not exist, i.e. "0303 is not applied" — and with `attachFunction` on it runs the
 *     function's rule in one synchronous step (the real one runs under the quote's row
 *     lock; scripts/sql-harness-0303.mjs proves the SQL itself).
 *   - `beforeOp` (review r5): a hook that runs before EVERY statement, for the two things
 *     a money path has to survive and a plain fake cannot show. It may be async, so a test
 *     can run ANOTHER request to completion between one request's read and its write (a
 *     revise landing under a re-price). And it may answer `"cut"`: that statement then
 *     never answers at all — the promise stays pending for ever, which is what a function
 *     that was killed there (a timeout, a crash, a deploy) looks like to everything after
 *     it. Not an error: an error is caught and handled; a death is not.
 *
 * Never a real database. Rows are plain objects the test owns and may inspect afterwards.
 */
export type Row = Record<string, unknown>;

export interface FakeOp {
  /** A table name, or `rpc:<function>` for an rpc call. */
  table: string;
  kind: "select" | "insert" | "update" | "rpc";
  payload?: unknown;
  matched: number;
}

export interface PaymentsFake {
  client: never;
  tables: Record<string, Row[]>;
  ops: FakeOp[];
  /** Table names whose NEXT select fails (one entry = one failure). */
  failSelect: string[];
  failUpdate: string[];
  failInsert: string[];
  /** Enforce 0303's one-open-checkout index (off by default = "migration not applied"). */
  enforceOneOpenCheckout: boolean;
  /** 0303's `catering_payment_attach_checkout` exists (off by default = PGRST202). */
  attachFunction: boolean;
  /** See the header. Null = no hook. Statements the hook itself issues go through it too,
   *  so a hook that runs another request disarms itself first. */
  beforeOp: ((op: { table: string; kind: "select" | "insert" | "update"; payload: unknown }) => void | "cut" | Promise<void | "cut">) | null;
}

/** Both halves of migration 0303 at once: the index and the attach function. */
export function apply0303(fake: PaymentsFake): PaymentsFake {
  fake.enforceOneOpenCheckout = true;
  fake.attachFunction = true;
  return fake;
}

type Settled = { data: unknown; error: { code?: string; message: string } | null; count: number | null };

const isNull = (v: unknown) => v === null || v === undefined;
let seq = 0;

function take(list: string[], table: string): boolean {
  const i = list.indexOf(table);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/** Would `rows` (the whole table after a proposed write) break a payment unique index? */
function paymentIndexViolation(rows: Row[], enforceOpenCheckout: boolean): string | null {
  const due = rows.filter((r) => r.status === "due");
  const seenDue = new Set<string>();
  for (const r of due) {
    const k = `${r.quote_id}|${r.kind}`;
    if (seenDue.has(k)) return "catering_payments_one_due";
    seenDue.add(k);
  }
  if (enforceOpenCheckout) {
    const seenOpen = new Set<unknown>();
    for (const r of due) {
      if (isNull(r.provider_session_id)) continue;
      if (seenOpen.has(r.quote_id)) return "catering_payments_one_open_checkout";
      seenOpen.add(r.quote_id);
    }
  }
  return null;
}

export function paymentsFake(tables: Record<string, Row[]>): PaymentsFake {
  const db: PaymentsFake = {
    client: null as never,
    tables,
    ops: [],
    failSelect: [],
    failUpdate: [],
    failInsert: [],
    enforceOneOpenCheckout: false,
    attachFunction: false,
    beforeOp: null,
  };

  /**
   * `catering_payment_attach_checkout` (0303), rule for rule and in the same order as the
   * SQL: the intent first (not_due / not_payable / in_progress), then the quote
   * (already_paid / session_unresolved), then the write. One synchronous step, as the real
   * function is one transaction under the quote's row lock.
   */
  function attachCheckout(args: Row): Settled {
    const ok = (outcome: string): Settled => ({ data: outcome, error: null, count: null });
    const pays = (tables.catering_payments ??= []);
    const quote = (tables.catering_quotes ?? []).find((q) => q.id === args.p_quote_id);
    if (!quote || !isNull(quote.superseded_at)) return ok("not_payable");
    const pay = pays.find((r) => r.id === args.p_payment_id);
    if (!pay || pay.status !== "due") return ok("not_due");
    if (pay.quote_id !== args.p_quote_id || pay.amount_cents !== args.p_amount_cents) return ok("not_payable");
    if (!isNull(pay.provider_session_id)) return ok("in_progress");
    const onQuote = pays.filter((r) => r.quote_id === args.p_quote_id);
    if (onQuote.some((r) => r.status === "paid")) return ok("already_paid");
    if (onQuote.some((r) => r.id !== pay.id && (r.status === "due" || r.status === "void") && !isNull(r.provider_session_id))) {
      return ok("session_unresolved");
    }
    pay.provider = "stripe";
    pay.provider_session_id = args.p_session_id;
    return ok("attached");
  }

  async function rpc(name: string, args: Row): Promise<Settled> {
    if (name !== "catering_payment_attach_checkout" || !db.attachFunction) {
      db.ops.push({ table: `rpc:${name}`, kind: "rpc", payload: args, matched: 0 });
      return {
        data: null,
        error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` },
        count: null,
      };
    }
    const out = attachCheckout(args);
    db.ops.push({ table: `rpc:${name}`, kind: "rpc", payload: args, matched: out.data === "attached" ? 1 : 0 });
    return out;
  }

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let kind: "select" | "insert" | "update" = "select";
    let payload: unknown = null;
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    const rows = () => (tables[table] ??= []);

    const run = (): Settled => {
      if (kind === "insert") {
        if (take(db.failInsert, table)) {
          db.ops.push({ table, kind, payload, matched: 0 });
          return { data: null, error: { message: "fake insert failure" }, count: null };
        }
        const inserted = ((Array.isArray(payload) ? payload : [payload]) as Row[]).map((p) => ({
          // UUID-shaped, because several loaders validate an id's shape before they query.
          id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
          created_at: new Date(Date.UTC(2030, 0, 1, 0, 0, seq)).toISOString(),
          ...p,
        }));
        // PRIMARY KEY: an explicit id that already exists is a 23505 (the Stripe ledger's
        // whole idempotency guard is exactly this).
        const taken = new Set(rows().map((r) => r.id));
        if (((Array.isArray(payload) ? payload : [payload]) as Row[]).some((p) => p.id !== undefined && taken.has(p.id))) {
          db.ops.push({ table, kind, payload, matched: 0 });
          return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${table}_pkey"` }, count: null };
        }
        if (table === "catering_payments") {
          const bad = paymentIndexViolation([...rows(), ...inserted], db.enforceOneOpenCheckout);
          if (bad) {
            db.ops.push({ table, kind, payload, matched: 0 });
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${bad}"` }, count: null };
          }
        }
        rows().push(...inserted);
        db.ops.push({ table, kind, payload, matched: inserted.length });
        return { data: inserted.map((r) => ({ ...r })), error: null, count: inserted.length };
      }

      const matched = rows().filter((r) => filters.every((f) => f(r)));
      if (kind === "update") {
        if (take(db.failUpdate, table)) {
          db.ops.push({ table, kind, payload, matched: 0 });
          return { data: null, error: { message: "fake update failure" }, count: null };
        }
        if (table === "catering_payments") {
          const after = rows().map((r) => (matched.includes(r) ? { ...r, ...(payload as Row) } : r));
          const bad = paymentIndexViolation(after, db.enforceOneOpenCheckout);
          if (bad) {
            db.ops.push({ table, kind, payload, matched: 0 });
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${bad}"` }, count: null };
          }
        }
        for (const r of matched) Object.assign(r, payload as Row);
        db.ops.push({ table, kind, payload, matched: matched.length });
        return { data: matched.map((r) => ({ ...r })), error: null, count: matched.length };
      }

      if (take(db.failSelect, table)) {
        db.ops.push({ table, kind, matched: 0 });
        return { data: null, error: { message: "fake select failure" }, count: null };
      }
      let out = [...matched];
      if (orderBy) {
        const { col, asc } = orderBy;
        out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (limitN !== null) out = out.slice(0, limitN);
      db.ops.push({ table, kind, matched: out.length });
      return { data: out.map((r) => ({ ...r })), error: null, count: out.length };
    };

    /** `run()`, after the test's hook has had its say (see `beforeOp`). With no hook this
     *  executes at the moment the statement is awaited, exactly as before. */
    const settle = async (): Promise<Settled> => {
      if (db.beforeOp) {
        const verdict = await db.beforeOp({ table, kind, payload });
        if (verdict === "cut") return new Promise<Settled>(() => {});
      }
      return run();
    };

    const one = (r: Settled, required: boolean): Settled => {
      if (r.error) return r;
      const list = (r.data as Row[] | null) ?? [];
      if (required && list.length !== 1) {
        return { data: null, error: { code: "PGRST116", message: "fake: expected exactly one row" }, count: r.count };
      }
      return { data: list[0] ?? null, error: null, count: r.count };
    };

    const q = {
      select: (_columns?: string) => q,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
      is: (c: string, v: null | boolean) => { filters.push((r) => (v === null ? isNull(r[c]) : r[c] === v)); return q; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      not: (c: string, operator: string, v: unknown) => {
        if (operator !== "is" || v !== null) throw new Error(`payments-fake: unsupported not(${c}, ${operator})`);
        filters.push((r) => !isNull(r[c]));
        return q;
      },
      /** PostgREST `or=(a.is.null,a.eq.x)` — the two verbs the payment paths use, no more. */
      or: (expr: string) => {
        const tests = expr.split(",").map((term) => {
          const [c, verb, ...rest] = term.split(".");
          const v = rest.join(".");
          if (!c || (verb !== "is" && verb !== "eq") || (verb === "is" && v !== "null")) {
            throw new Error(`payments-fake: unsupported or() term ${term}`);
          }
          return verb === "is" ? (r: Row) => isNull(r[c]) : (r: Row) => String(r[c]) === v;
        });
        filters.push((r) => tests.some((t) => t(r)));
        return q;
      },
      order: (c: string, o?: { ascending?: boolean }) => { orderBy = { col: c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { limitN = n; return q; },
      returns: () => q,
      insert: (p: unknown) => { kind = "insert"; payload = p; return q; },
      update: (p: unknown, _opts?: unknown) => { kind = "update"; payload = p; return q; },
      maybeSingle: async () => one(await settle(), false),
      single: async () => one(await settle(), true),
      then: (resolve: (v: Settled) => unknown, reject?: (e: unknown) => unknown) => settle().then(resolve, reject),
    };
    return q;
  }

  db.client = { from, rpc } as never;
  return db;
}
