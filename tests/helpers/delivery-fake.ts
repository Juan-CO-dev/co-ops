/**
 * Catering delivery D2: a chainable PostgREST stand-in for the delivery lib (the D1 lib test's, shared). Every settled
 * read and every RPC is recorded by name, so a test can prove "refused before any database work" (`reads` and `calls`
 * both empty). A table answers from its filters; an RPC answers `{ data }` or `{ error: { code, message } }`.
 */
import type { AuthContext } from "@/lib/session";

export type FakeResult = { data?: unknown; error?: { code?: string; message?: string } | null };
export interface FakeQuery { eq: Record<string, unknown>; in: Record<string, unknown[]>; is: Record<string, unknown>; gte: Record<string, unknown>; range: [number, number] | null }
export type FakeTables = Record<string, (q: FakeQuery) => FakeResult>;
export type FakeRpcs = Record<string, (params: Record<string, unknown>) => FakeResult>;

export function deliveryFake(tables: FakeTables, rpcs: FakeRpcs = {}) {
  const reads: string[] = [];
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const chain = (name: string, answer: (q: FakeQuery) => FakeResult) => {
    const query: FakeQuery = { eq: {}, in: {}, is: {}, gte: {}, range: null };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order"]) q[m] = () => q;
    q.eq = (col: string, value: unknown) => { query.eq[col] = value; return q; };
    q.is = (col: string, value: unknown) => { query.is[col] = value; return q; };
    q.in = (col: string, value: unknown[]) => { query.in[col] = value; return q; };
    q.gte = (col: string, value: unknown) => { query.gte[col] = value; return q; };
    q.range = (from: number, to: number) => { query.range = [from, to]; return q; };
    const settle = () => { reads.push(name); return Promise.resolve({ data: null, error: null, ...answer(query) }); };
    q.maybeSingle = () => settle().then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }));
    q.then = (resolve: (r: FakeResult) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject);
    return q;
  };
  const sb = {
    from: (name: string) => chain(name, (q) => { const t = tables[name]; if (!t) throw new Error(`unexpected table ${name}`); return t(q); }),
    rpc: (name: string, params: Record<string, unknown>) => { calls.push({ name, params }); return chain(`rpc:${name}`, () => { const f = rpcs[name]; if (!f) throw new Error(`unexpected rpc ${name}`); return f(params); }); },
  };
  return { sb: sb as never, reads, calls };
}

/** An AuthContext with exactly what the delivery lib and the step-up check read. */
export function deliveryActor(role: string, locations: string[] = [], session: Partial<{ stepUpUnlocked: boolean; stepUpUnlockedAt: string | null }> = {}, active = true): AuthContext {
  return { user: { id: "00000000-0000-4000-8000-0000000000aa", role, active, language: "en" }, role, level: 0, locations,
    session: { stepUpUnlocked: false, stepUpUnlockedAt: null, catalogEditUnlockedAt: null, ...session } } as unknown as AuthContext;
}
