/**
 * A small PREDICATE-AWARE fake service client for the catering payment paths (audit wave
 * W02). Same idea as tests/fake-supabase.ts — every filter the code under test applies is
 * really applied to in-memory rows — plus the four things the money paths lean on that the
 * shared fake does not model:
 *
 *   - `count` on a write (`{ count: "exact" }`): the silent-UPDATE law is checked by
 *     rowcount, so a guarded flip that matches nothing must REPORT zero.
 *   - `.single()` after an insert, and `.neq()` / `.or()`-free filter chains.
 *   - UNIQUE INDEXES as predicates: `catering_payments_one_due` (0130) and
 *     `catering_payments_one_open_checkout` (0303) are emulated, so a write that would
 *     violate one returns a real `23505` and applies nothing.
 *   - per-table failure injection for reads (`failSelect`) and writes (`failUpdate`,
 *     `failInsert`), each consumed once per listed entry.
 *
 * Never a real database. Rows are plain objects the test owns and may inspect afterwards.
 */
export type Row = Record<string, unknown>;

export interface FakeOp {
  table: string;
  kind: "select" | "insert" | "update";
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
  };

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
          id: `${table}-new-${++seq}`,
          created_at: new Date(Date.UTC(2030, 0, 1, 0, 0, seq)).toISOString(),
          ...p,
        }));
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
      order: (c: string, o?: { ascending?: boolean }) => { orderBy = { col: c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { limitN = n; return q; },
      returns: () => q,
      insert: (p: unknown) => { kind = "insert"; payload = p; return q; },
      update: (p: unknown, _opts?: unknown) => { kind = "update"; payload = p; return q; },
      maybeSingle: async () => one(run(), false),
      single: async () => one(run(), true),
      then: (resolve: (v: Settled) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  }

  db.client = { from } as never;
  return db;
}
