// Business report access, plan r5 section 2 (contract points 2 to 4) and section 7 test 3: THE MODEL.
//
// A small exact (rational) model of how the labor figures of the report depend on PAY INPUTS (each hourly person's
// rate, each salaried person's share), and a checker that says which unknowns a viewer can work out from the terms
// they see. DOMAIN, exactly: the relations below; the fixtures F1 to F5; one rate per hourly person; a viewer who
// knows every visible term EXACTLY, plus net sales, the burden rate and everyone's minutes. It is a design check of
// the grouping in lib/business-access-shared.ts, not a proof about every report that can exist.
//
// Model quantities are exact: cents and minutes as rationals, rates in cents per minute. The serialized DTO shows
// ROUNDINGS of some of them (tests/business-report-pay-inference.test.ts, "model to serialized").

export type Q = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => { a = a < BigInt(0) ? -a : a; b = b < BigInt(0) ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
export function q(n: number | bigint, d: number | bigint = 1): Q {
  let nn = BigInt(n), dd = BigInt(d);
  if (dd === BigInt(0)) throw new Error("division by zero");
  if (dd < BigInt(0)) { nn = -nn; dd = -dd; }
  const g = gcd(nn, dd) || BigInt(1);
  return { n: nn / g, d: dd / g };
}
export const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Q, b: Q) => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
export const div = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);
export const isZero = (a: Q) => a.n === BigInt(0);
export const eq = (a: Q, b: Q) => a.n === b.n && a.d === b.d;
export const num = (a: Q) => Number(a.n) / Number(a.d);
export const isWhole = (a: Q) => a.d === BigInt(1);
const ZERO = q(0), ONE = q(1);

/** The shop: who worked (minutes, overtime minutes), how many people are salaried, net sales, the burden rate. */
export interface Fixture { name: string; hourly: Array<{ minutes: number; ot: number }>; salaried: number; netCents: number; burdenPct: number }
/** The pay inputs: one rate (cents per minute) per hourly person, one share (cents) per salaried person. */
export interface Pay { rates: Q[]; shares: Q[] }

export const FIGURE_TERMS = ["straight", "premium", "hourly", "pct", "salaries", "burden", "loaded", "loadedPct"] as const;
export type FigureTerm = (typeof FIGURE_TERMS)[number];
/** Where each figure term lives in the access table (`never` = no viewer ever receives it as a figure). */
export const TERM_GROUP: Record<FigureTerm, "hourlyCost" | "loaded" | "never"> = {
  straight: "never", premium: "hourlyCost", hourly: "hourlyCost", pct: "hourlyCost", salaries: "loaded", burden: "loaded", loaded: "loaded", loadedPct: "loaded",
};
export const rateTerm = (i: number) => `rate[${i}]`;
export const shareTerm = (j: number) => `share[${j}]`;
export const isPayInput = (term: string) => term.startsWith("rate[") || term.startsWith("share[");

/** Every term's exact value for this shop at this pay. */
export function evaluate(f: Fixture, pay: Pay): Record<string, Q> {
  const r = q(f.burdenPct, 100), net = q(f.netCents);
  const straight = f.hourly.reduce((s, p, i) => add(s, mul(q(p.minutes), pay.rates[i]!)), ZERO);
  const premium = f.hourly.reduce((s, p, i) => add(s, mul(q(p.ot, 2), pay.rates[i]!)), ZERO);
  const hourly = add(straight, premium);
  const salaries = pay.shares.slice(0, f.salaried).reduce(add, ZERO);
  const burden = mul(r, add(hourly, salaries));
  const loaded = add(add(hourly, salaries), burden);
  const out: Record<string, Q> = { straight, premium, hourly, salaries, burden, loaded, pct: div(mul(q(100), hourly), net), loadedPct: div(mul(q(100), loaded), net) };
  f.hourly.forEach((_, i) => { out[rateTerm(i)] = pay.rates[i]!; });
  for (let j = 0; j < f.salaried; j++) out[shareTerm(j)] = pay.shares[j]!;
  return out;
}

/** A linear relation: sum(coef x term) = 0. */
type Relation = { name: string; terms: Record<string, Q> };
/** The relations of plan r5 section 2, linear in the terms once net sales, the burden rate and the minutes are known. */
export function relations(f: Fixture, extra: Relation[] = []): Relation[] {
  const r = q(f.burdenPct, 100), net = q(f.netCents), neg = (x: Q) => sub(ZERO, x);
  const sum = (make: (i: number) => [string, Q], count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => make(i)));
  return [
    { name: "H1 straight = sum(minutes x rate)", terms: { straight: ONE, ...sum((i) => [rateTerm(i), neg(q(f.hourly[i]!.minutes))], f.hourly.length) } },
    { name: "H2 premium = 0.5 x sum(overtime minutes x rate)", terms: { premium: ONE, ...sum((i) => [rateTerm(i), neg(q(f.hourly[i]!.ot, 2))], f.hourly.length) } },
    { name: "I1 hourly = straight + premium", terms: { hourly: ONE, straight: neg(ONE), premium: neg(ONE) } },
    { name: "H3 salaries = sum(share)", terms: { salaries: ONE, ...sum((j) => [shareTerm(j), neg(ONE)], f.salaried) } },
    { name: "I3 loaded = hourly + salaries + burden", terms: { loaded: ONE, hourly: neg(ONE), salaries: neg(ONE), burden: neg(ONE) } },
    { name: "I5 burden = r x (hourly + salaries)", terms: { burden: ONE, hourly: neg(r), salaries: neg(r) } },
    { name: "I2 net x pct = 100 x hourly", terms: { pct: net, hourly: neg(q(100)) } },
    { name: "I4 net x loadedPct = 100 x loaded", terms: { loadedPct: net, loaded: neg(q(100)) } },
    ...extra,
  ];
}
/** A probe for the negative controls: one person's straight-time cost as its own (visible) term. */
export function personStraight(f: Fixture, i: number): { relation: Relation; term: string; value: (pay: Pay) => Q } {
  const term = `personStraight[${i}]`;
  return { term, relation: { name: `${term} = minutes x rate`, terms: { [term]: ONE, [rateTerm(i)]: sub(ZERO, q(f.hourly[i]!.minutes)) } },
    value: (pay) => mul(q(f.hourly[i]!.minutes), pay.rates[i]!) };
}

/**
 * THE CHECKER. The viewer knows the exact value of every term in `visible`. Every other term (hidden figures and
 * all pay inputs) is an unknown. Returns the unknowns whose value the relations FIX (the same in every solution),
 * with that value: row reduction to reduced echelon form; an unknown is fixed exactly when its pivot row has no
 * other unknown in it.
 */
export function determined(f: Fixture, pay: Pay, visible: ReadonlySet<string>, extra: Array<{ relation: Relation; term: string; value: (pay: Pay) => Q }> = []): Map<string, Q> {
  const values = evaluate(f, pay);
  for (const e of extra) values[e.term] = e.value(pay);
  const rels = relations(f, extra.map((e) => e.relation));
  const unknowns = [...new Set(rels.flatMap((r) => Object.keys(r.terms)))].filter((t) => !visible.has(t)).sort();
  // Each row: coefficients over the unknowns, then the constant (the visible terms moved to the right-hand side).
  const rows = rels.map((r) => {
    const row = unknowns.map((u) => r.terms[u] ?? ZERO);
    const rhs = Object.entries(r.terms).filter(([t]) => visible.has(t)).reduce((s, [t, c]) => sub(s, mul(c, values[t]!)), ZERO);
    return [...row, rhs];
  });
  let lead = 0;
  const pivots: Array<{ row: number; col: number }> = [];
  for (let col = 0; col < unknowns.length && lead < rows.length; col++) {
    const at = rows.findIndex((r, i) => i >= lead && !isZero(r[col]!));
    if (at < 0) continue;
    [rows[lead], rows[at]] = [rows[at]!, rows[lead]!];
    const p = rows[lead]![col]!;
    rows[lead] = rows[lead]!.map((x) => div(x, p));
    for (let i = 0; i < rows.length; i++) {
      if (i === lead || isZero(rows[i]![col]!)) continue;
      const k = rows[i]![col]!;
      rows[i] = rows[i]!.map((x, j) => sub(x, mul(k, rows[lead]![j]!)));
    }
    pivots.push({ row: lead, col });
    lead++;
  }
  const out = new Map<string, Q>();
  for (const { row, col } of pivots) {
    const r = rows[row]!;
    if (unknowns.every((_, j) => j === col || isZero(r[j]!))) out.set(unknowns[col]!, r[unknowns.length]!);
  }
  return out;
}

/** The figure terms a viewer with these groups sees (`straight` never). */
export function visibleTerms(groups: { hourlyCost: boolean; loaded: boolean }): Set<string> {
  return new Set(FIGURE_TERMS.filter((t) => { const g = TERM_GROUP[t]; return g !== "never" && groups[g]; }));
}

// ── Fixtures (plan r5 test 3). Positive burden rate and positive net sales in every one (Astra r5 P3). ──
const HOUR = 60;
export const F1: Fixture = { name: "F1 two hourly (different overtime ratios) + one salaried", hourly: [{ minutes: 45 * HOUR, ot: 5 * HOUR }, { minutes: 40 * HOUR, ot: 0 }], salaried: 1, netCents: 1_000_000, burdenPct: 12 };
export const F2: Fixture = { name: "F2 two hourly at 45 h / 5 h overtime each, nobody salaried", hourly: [{ minutes: 45 * HOUR, ot: 5 * HOUR }, { minutes: 45 * HOUR, ot: 5 * HOUR }], salaried: 0, netCents: 1_000_000, burdenPct: 12 };
export const F3: Fixture = { name: "F3 zero overtime: two hourly + one salaried", hourly: [{ minutes: 40 * HOUR, ot: 0 }, { minutes: 30 * HOUR, ot: 0 }], salaried: 1, netCents: 1_000_000, burdenPct: 12 };
export const F4: Fixture = { name: "F4 zero hours, nobody salaried", hourly: [], salaried: 0, netCents: 1_000_000, burdenPct: 12 };
export const F5: Fixture = { name: "F5 one hourly person alone, with overtime, nobody salaried", hourly: [{ minutes: 45 * HOUR, ot: 5 * HOUR }], salaried: 0, netCents: 1_000_000, burdenPct: 12 };
export const FIXTURES = [F1, F2, F3, F4, F5] as const;
/** Three pay vectors (cents per minute: 100/3 = $20/h, 50 = $30/h, 40 = $24/h ...; shares in cents). Every figure
 * they produce is whole cents (asserted). The first prices F2 at the reviewer's $2,375 / $125. */
export const PAYS: readonly Pay[] = [
  { rates: [q(100, 3), q(50)], shares: [q(100_000)] },
  { rates: [q(40), q(30)], shares: [q(150_000)] },
  { rates: [q(35), q(45)], shares: [q(82_500)] },
];
