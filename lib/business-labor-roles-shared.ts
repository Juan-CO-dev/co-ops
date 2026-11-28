/**
 * Digest LABOR MONEY, cost by role (digests round 3, PR 4; plan §3.5 as amended by §11.2.4, §11.2.5, §13.2.6 and
 * §13.2.8 P3-2 / P3-5). PURE: zero I/O, no env, no clock.
 *
 * THE RULE THIS MODULE ENFORCES: no one person's pay may be worked out from the cost-by-role line (F5). The digest
 * goes to people who also see the day's hourly total (F1), so a bucket of one person, or two buckets that differ by
 * one person, or a bucket that holds everyone but one person, would print that person's straight-time pay. Every such
 * bucket is merged into "Other roles" until none is left; with too few buckets the line is omitted. Small crews will
 * often lose the line: that is the safe side.
 *
 * Input: the people read of ONE day (`business_report_labor_people`, one row per week, person, role, source and pay
 * class). The person keys are opaque and used ONLY to count contributors here; nothing of a person leaves this module
 * (Opus P3-5): the result holds role names and cents, never a key, a label or an id.
 *
 * Steps, in order (each named where it lives below):
 *   1. only HOURLY rows count (a salaried coworker is never a contributor and adds no cents);
 *   2. the bucket of a row: its 7shifts role name, trimmed; no role, role 0, no name, an empty name and EVERY
 *      Toast-sourced row are "Other" (never a Toast job name); two role ids with one trimmed name are one bucket;
 *   3. a contributor = a distinct person with MORE than 0 straight-time cents in the bucket (§11.2.4);
 *   4. a bucket with fewer than 2 contributors is pooled into "Other roles"; a pool with fewer than 2 takes in the
 *      smallest printed bucket, and so on;
 *   5. the finished-bucket rule (§11.2.4, P3-2) on the printed buckets, run until it passes;
 *   6. fewer than two printed buckets = omitted;
 *   8. the rounding bound (§13.2.6) against the day's own straight-time cents.
 */
import type { RoleBucket, RoleLaborFacts } from "@/lib/business-labor-shared";

/** One row of the people read for the day, as the core maps it (`role_key` bigint → string; 0 / null → null). */
export interface RolePeopleRow { personKey: string; roleKey: string | null; source: string; payClass: string; straightCents: number | null }

/** The Toast source value of `labor_quarter.source` (0338: check `source in ('7shifts', 'toast')`). */
const TOAST_SOURCE = "toast";
const HOURLY = "hourly";

interface Bucket {
  kind: RoleBucket["kind"];
  name: string | null;
  cents: number;
  /** person key → straight-time cents in this bucket (opaque; never leaves the module). */
  people: Map<string, number>;
}

const isCents = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Step 3: the distinct people with more than 0 cents in the bucket. */
function contributors(b: Bucket): Set<string> {
  const out = new Set<string>();
  for (const [k, c] of b.people) if (c > 0) out.add(k);
  return out;
}

/** "Ties by name": role buckets by their name, then Other, then the pool. A total order, so merging is deterministic. */
function tieKey(b: Bucket): string {
  return `${b.kind === "role" ? 0 : b.kind === "other" ? 1 : 2}|${b.name ?? ""}`;
}
/** Smallest first: fewest cents, then the name. */
function smaller(a: Bucket, b: Bucket): number {
  if (a.cents !== b.cents) return a.cents - b.cents;
  const ka = tieKey(a), kb = tieKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function absorb(into: Bucket, from: Bucket): void {
  into.cents += from.cents;
  for (const [k, c] of from.people) into.people.set(k, (into.people.get(k) ?? 0) + c);
}

const sizeOfDifference = (p: Set<string>, q: Set<string>): number => {
  let n = 0;
  for (const k of p) if (!q.has(k)) n++;
  return n;
};

/**
 * Steps 1 to 6. Returns the finished printed buckets WITH their contributor sets (internal), or "omitted", or
 * "unavailable" (an hourly row or the day total that is not a whole, non-negative number of cents: unknown is never 0).
 */
function finishBuckets(rows: readonly RolePeopleRow[], roleNames: ReadonlyMap<string, string | null>, dayStraightCents: number):
  { kind: "buckets"; buckets: Bucket[]; groups: number } | { kind: "omitted" } | { kind: "unavailable" } {
  if (!isCents(dayStraightCents)) return { kind: "unavailable" };
  // Step 9: the same rows in ANY order give the same result. Sort a copy first.
  const sorted = [...rows].sort((a, b) => {
    const ka = [a.personKey, a.roleKey ?? "", a.source, a.payClass, String(a.straightCents)];
    const kb = [b.personKey, b.roleKey ?? "", b.source, b.payClass, String(b.straightCents)];
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
    return 0;
  });

  // Step 1: hourly rows only. Step 8's G counts every hourly row (a zero-cent one too), BEFORE pooling.
  let groups = 0;
  const byKey = new Map<string, Bucket>();
  for (const r of sorted) {
    if (r.payClass !== HOURLY) continue;
    if (!isCents(r.straightCents)) return { kind: "unavailable" };
    groups++;
    // Step 2: the role's name, or "Other".
    const raw = r.source === TOAST_SOURCE || r.roleKey === null || r.roleKey === "0" ? null : roleNames.get(r.roleKey);
    const name = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
    const key = name === null ? "other" : `role:${name}`;
    let b = byKey.get(key);
    if (!b) { b = { kind: name === null ? "other" : "role", name, cents: 0, people: new Map() }; byKey.set(key, b); }
    b.cents += r.straightCents;
    b.people.set(r.personKey, (b.people.get(r.personKey) ?? 0) + r.straightCents);
  }

  // Step 4: pooling. Every bucket with fewer than two contributors goes into the ONE pool.
  let printed: Bucket[] = [];
  let pool: Bucket | null = null;
  for (const b of [...byKey.values()].sort(smaller)) {
    if (contributors(b).size >= 2) { printed.push(b); continue; }
    pool ??= { kind: "pool", name: null, cents: 0, people: new Map() };
    absorb(pool, b);
  }
  // A pool of fewer than two takes in the smallest printed bucket, and so on.
  while (pool !== null && contributors(pool).size < 2 && printed.length > 0) {
    printed.sort(smaller);
    absorb(pool, printed.shift()!);
  }

  // Step 5: the finished-bucket rule (§11.2.4, P3-2), on the FINISHED printed buckets, until it passes.
  for (;;) {
    const all = pool === null ? printed : [...printed, pool];
    // Step 6: fewer than two printed buckets = the line does not exist.
    if (all.length < 2) return { kind: "omitted" };
    const sets = new Map<Bucket, Set<string>>(all.map((b) => [b, contributors(b)]));
    const union = new Set<string>();
    for (const s of sets.values()) for (const k of s) union.add(k);
    const failing: Array<[Bucket, Bucket]> = [];
    for (const p of all) {
      const sp = sets.get(p)!;
      // (a) the people in P who are not in Q are exactly one person (either way round: both orders are visited).
      for (const q of all) if (p !== q && sizeOfDifference(sp, sets.get(q)!) === 1) failing.push([p, q]);
      // (b) everyone in the printed buckets but one person is in P: P and the smallest OTHER bucket.
      if (sizeOfDifference(union, sp) === 1) failing.push([p, all.filter((x) => x !== p).sort(smaller)[0]!]);
    }
    if (failing.length === 0) return { kind: "buckets", buckets: all, groups };
    // Of several failing pairs, merge first the pair whose smaller bucket has the fewest cents (ties by name; then the
    // larger bucket the same way, so the choice is total).
    const ordered = failing.map(([x, y]) => (smaller(x, y) <= 0 ? [x, y] : [y, x]) as [Bucket, Bucket])
      .sort((a, b) => smaller(a[0], b[0]) || smaller(a[1], b[1]));
    const [x, y] = ordered[0]!;
    // Both go into the ONE pool, which absorbs every later merge. Each step lowers the number of printed buckets.
    const target: Bucket = pool ?? { kind: "pool", name: null, cents: 0, people: new Map() };
    for (const b of [x, y]) if (b !== target) absorb(target, b);
    printed = printed.filter((b) => b !== x && b !== y);
    pool = target;
  }
}

/** Step 9's order: role buckets by cents descending then name, then Other, then the pool. */
function printOrder(a: Bucket, b: Bucket): number {
  const rank = (k: Bucket["kind"]) => (k === "role" ? 0 : k === "other" ? 1 : 2);
  if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
  if (a.cents !== b.cents) return b.cents - a.cents;
  const na = a.name ?? "", nb = b.name ?? "";
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/**
 * THE cost-by-role facts of one day. Holds NO person (step 10). `{ kind: "omitted" }` = fewer than two printable
 * buckets (F5 does not exist); `{ kind: "unavailable" }` = the people read and the day row do not describe the same
 * rows (outside the rounding bound), or an amount is unknown → "Cost by role not available".
 */
export function roleBuckets(rows: readonly RolePeopleRow[], roleNames: ReadonlyMap<string, string | null>,
  day: { date: string; dayStraightCents: number; wageEstimated: boolean }): RoleLaborFacts {
  const done = finishBuckets(rows, roleNames, day.dayStraightCents);
  if (done.kind !== "buckets") return done;
  // Step 8, the rounding bound (§13.2.6): each hourly group is rounded on its own, so the printed buckets may differ
  // from the day's once-rounded total by at most half a cent per hourly group (G, counted before pooling).
  const sum = done.buckets.reduce((s, b) => s + b.cents, 0);
  const diff = Math.abs(sum - day.dayStraightCents);
  if (diff !== 0 && 2 * diff > done.groups) return { kind: "unavailable" };
  return {
    kind: "ok",
    date: day.date,
    buckets: [...done.buckets].sort(printOrder).map((b) => ({ kind: b.kind, name: b.kind === "role" ? b.name : null, cents: b.cents })),
    roundedSeparately: diff !== 0,
    wageEstimated: day.wageEstimated,
  };
}

/**
 * TESTS ONLY: the finished printed buckets with their contributor sets, in the order `roleBuckets` prints them (empty
 * when the line is omitted or an amount is unknown; the rounding bound is not applied here). The digest never calls
 * it; the sets exist so the tests can assert on SETS.
 */
export function roleBucketSetsForTest(rows: readonly RolePeopleRow[], roleNames: ReadonlyMap<string, string | null>, dayStraightCents: number):
  Array<{ kind: RoleBucket["kind"]; name: string | null; cents: number; contributors: string[] }> {
  const done = finishBuckets(rows, roleNames, dayStraightCents);
  if (done.kind !== "buckets") return [];
  return [...done.buckets].sort(printOrder).map((b) => ({ kind: b.kind, name: b.kind === "role" ? b.name : null, cents: b.cents,
    contributors: [...contributors(b)].sort() }));
}
