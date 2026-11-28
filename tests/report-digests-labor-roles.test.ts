// Digest labor money, cost by role (digests round 3, PR 4; plan §3.5, §11.2.4, §11.2.5, §13.2.6, §13.2.8 P3-2 / P3-5).
// THE RULE: no one person's pay can be worked out from the F5 line. Every test asserts on contributor SETS
// (roleBucketSetsForTest), not just numbers. Synthetic people only ("p-a" …); the keys are opaque.
import { describe, expect, it } from "vitest";
import { roleBucketSetsForTest, roleBuckets, type RolePeopleRow } from "@/lib/business-labor-roles-shared";

const NAMES = new Map<string, string | null>([["1", "Cook"], ["2", "Cashier"], ["3", "Prep"], ["4", " Cook  "], ["5", "   "], ["6", null]]);
const DATE = "2026-11-20";

const h = (personKey: string, roleKey: string | null, straightCents: number, source = "7shifts"): RolePeopleRow =>
  ({ personKey, roleKey, source, payClass: "hourly", straightCents });
const sal = (personKey: string, roleKey: string | null): RolePeopleRow => ({ personKey, roleKey, source: "7shifts", payClass: "salaried", straightCents: null });
const hourlySum = (rows: readonly RolePeopleRow[]) => rows.reduce((s, r) => s + (r.payClass === "hourly" ? r.straightCents ?? 0 : 0), 0);
const run = (rows: RolePeopleRow[], day = hourlySum(rows), wageEstimated = false) =>
  ({ facts: roleBuckets(rows, NAMES, { date: DATE, dayStraightCents: day, wageEstimated }), sets: roleBucketSetsForTest(rows, NAMES, day) });

/** The singleton rules, on SETS: ≥ 2 each; no P \ Q of exactly one; no "everyone but one" in P. */
function assertNoSingleton(sets: Array<{ contributors: string[] }>) {
  const s = sets.map((b) => new Set(b.contributors));
  const union = new Set(s.flatMap((x) => [...x]));
  for (const p of s) {
    expect(p.size).toBeGreaterThanOrEqual(2);
    expect([...union].filter((k) => !p.has(k)).length).not.toBe(1);
    for (const q of s) if (p !== q) expect([...p].filter((k) => !q.has(k)).length).not.toBe(1);
  }
}

describe("roleBuckets: who is a contributor, and which bucket a row is in", () => {
  it("one hourly + one salaried in a role: the role is pooled, never printed alone", () => {
    const rows = [h("p-a", "1", 1_000), sal("p-b", "1"), h("p-c", "2", 500), h("p-d", "2", 500), h("p-e", "3", 700), h("p-f", "3", 900)];
    const { facts, sets } = run(rows);
    expect(facts.kind).toBe("ok");
    assertNoSingleton(sets);
    expect(sets.find((b) => b.name === "Cook")).toBeUndefined();
    // The salaried coworker is never a contributor anywhere.
    expect(sets.flatMap((b) => b.contributors)).not.toContain("p-b");
    // Every hourly row is in exactly one printed bucket.
    expect(sets.reduce((s, b) => s + b.cents, 0)).toBe(hourlySum(rows));
  });
  it("duplicate rows for one identity are ONE contributor", () => {
    const alone = run([h("p-a", "1", 100), h("p-a", "1", 200), h("p-c", "2", 500), h("p-d", "2", 500)]);
    expect(alone.facts.kind).toBe("omitted"); // Cook's two rows are one person: pooled, then Cook + pool < 2 buckets.
    const { facts, sets } = run([h("p-a", "1", 100), h("p-a", "1", 200), h("p-b", "1", 300), h("p-c", "2", 500), h("p-d", "2", 500)]);
    expect(facts).toEqual({ kind: "ok", date: DATE, roundedSeparately: false, wageEstimated: false,
      buckets: [{ kind: "role", name: "Cashier", cents: 1_000 }, { kind: "role", name: "Cook", cents: 600 }] });
    expect(sets.find((b) => b.name === "Cook")!.contributors).toEqual(["p-a", "p-b"]);
    assertNoSingleton(sets);
  });
  it("a person who worked two roles is a contributor to both", () => {
    const { facts, sets } = run([h("p-a", "1", 100), h("p-b", "1", 100), h("p-c", "1", 100), h("p-a", "2", 50), h("p-d", "2", 50), h("p-e", "2", 50)]);
    expect(facts.kind).toBe("ok");
    expect(sets.find((b) => b.name === "Cook")!.contributors).toEqual(["p-a", "p-b", "p-c"]);
    expect(sets.find((b) => b.name === "Cashier")!.contributors).toEqual(["p-a", "p-d", "p-e"]);
    assertNoSingleton(sets);
  });
  it("every role single: the line is omitted", () => {
    expect(run([h("p-a", "1", 100), h("p-b", "2", 200), h("p-c", "3", 300)]).facts).toEqual({ kind: "omitted" });
    expect(run([h("p-a", "1", 100)]).facts).toEqual({ kind: "omitted" });
    expect(run([]).facts).toEqual({ kind: "omitted" });
  });
  it("{A,B} beside {A,B,C} is never two buckets (§11.2.4)", () => {
    expect(run([h("p-a", "1", 100), h("p-b", "1", 100), h("p-a", "2", 100), h("p-b", "2", 100), h("p-c", "2", 100)]).facts).toEqual({ kind: "omitted" });
    const { facts, sets } = run([h("p-a", "1", 100), h("p-b", "1", 100), h("p-a", "2", 100), h("p-b", "2", 100), h("p-c", "2", 100),
      h("p-d", "3", 400), h("p-e", "3", 400)]);
    expect(facts.kind).toBe("ok");
    assertNoSingleton(sets);
    const shapes = sets.map((b) => b.contributors.join());
    expect(shapes).not.toContain("p-a,p-b");
    expect(sets).toEqual([{ kind: "role", name: "Prep", cents: 800, contributors: ["p-d", "p-e"] },
      { kind: "pool", name: null, cents: 500, contributors: ["p-a", "p-b", "p-c"] }]);
  });
  it("everyone in the printed buckets but one person in P fails (P-3-2 second case)", () => {
    // Cook {A,B,C}, Cashier {D,E}, Prep {A,B,C,D}: union \ Prep = {E}.
    const { facts, sets } = run([h("p-a", "1", 10), h("p-b", "1", 10), h("p-c", "1", 10), h("p-d", "2", 10), h("p-e", "2", 10),
      h("p-a", "3", 10), h("p-b", "3", 10), h("p-c", "3", 10), h("p-d", "3", 10)]);
    if (facts.kind === "ok") assertNoSingleton(sets);
    expect(sets.map((b) => b.contributors.join())).not.toContain("p-a,p-b,p-c,p-d");
  });
  it("a zero-cent person does not make a bucket of one into a bucket of two", () => {
    const { facts, sets } = run([h("p-a", "1", 500), h("p-b", "1", 0), h("p-c", "2", 500), h("p-d", "2", 500), h("p-e", "3", 500), h("p-f", "3", 500)]);
    expect(facts.kind).toBe("ok");
    expect(sets.find((b) => b.name === "Cook")).toBeUndefined();
    expect(sets.flatMap((b) => b.contributors)).not.toContain("p-b");
    assertNoSingleton(sets);
  });
  it("every Toast-sourced row is Other, whatever its role key (never a Toast job name)", () => {
    const { facts, sets } = run([h("p-a", "1", 300, "toast"), h("p-b", "1", 300, "toast"), h("p-c", "2", 500), h("p-d", "2", 500)]);
    expect(facts).toMatchObject({ kind: "ok", buckets: [{ kind: "role", name: "Cashier", cents: 1_000 }, { kind: "other", name: null, cents: 600 }] });
    expect(sets.find((b) => b.kind === "other")!.contributors).toEqual(["p-a", "p-b"]);
  });
  it("role 0, no role, no name row, a blank or null name: Other", () => {
    const { facts, sets } = run([h("p-a", "0", 100), h("p-b", null, 100), h("p-c", "99", 100), h("p-d", "5", 100), h("p-e", "6", 100),
      h("p-f", "2", 500), h("p-g", "2", 500)]);
    expect(facts).toMatchObject({ kind: "ok", buckets: [{ kind: "role", name: "Cashier" }, { kind: "other", name: null, cents: 500 }] });
    expect(sets.find((b) => b.kind === "other")!.contributors).toEqual(["p-a", "p-b", "p-c", "p-d", "p-e"]);
  });
  it("two role ids with the same trimmed name are ONE bucket", () => {
    const { facts, sets } = run([h("p-a", "1", 100), h("p-b", "4", 100), h("p-c", "2", 500), h("p-d", "2", 500)]);
    expect(facts).toMatchObject({ kind: "ok", buckets: [{ kind: "role", name: "Cashier" }, { kind: "role", name: "Cook", cents: 200 }] });
    expect(sets.find((b) => b.name === "Cook")!.contributors).toEqual(["p-a", "p-b"]);
  });
  it("a pool of fewer than two takes in the smallest printed bucket", () => {
    // Cook {A} alone → pool {A}; the pool takes the smallest printed bucket (Prep, 200) → pool {A,E,F}.
    const { sets } = run([h("p-a", "1", 900), h("p-c", "2", 500), h("p-d", "2", 500), h("p-e", "3", 100), h("p-f", "3", 100)]);
    expect(sets).toEqual([{ kind: "role", name: "Cashier", cents: 1_000, contributors: ["p-c", "p-d"] },
      { kind: "pool", name: null, cents: 1_100, contributors: ["p-a", "p-e", "p-f"] }]);
  });
  it("an hourly amount that is unknown (not whole non-negative cents) is unavailable, never 0", () => {
    expect(run([h("p-a", "1", 100), { ...h("p-b", "1", 0), straightCents: null }, h("p-c", "2", 1), h("p-d", "2", 1)], 202).facts).toEqual({ kind: "unavailable" });
    expect(run([h("p-a", "1", 100), h("p-b", "1", 1.5)], 101).facts).toEqual({ kind: "unavailable" });
    expect(roleBuckets([h("p-a", "1", 1)], NAMES, { date: DATE, dayStraightCents: Number.NaN, wageEstimated: false })).toEqual({ kind: "unavailable" });
  });
  it("wageEstimated is passed through; the facts hold no person (P3-5)", () => {
    const rows = [h("p-a", "1", 100), h("p-b", "1", 100), h("p-c", "2", 500), h("p-d", "2", 500)];
    const { facts } = run(rows, hourlySum(rows), true);
    expect(facts).toMatchObject({ kind: "ok", wageEstimated: true });
    const json = JSON.stringify(facts);
    for (const k of ["p-a", "p-b", "p-c", "p-d", "personKey", "person_key", "person_label", "user_id"]) expect(json).not.toContain(k);
  });
});

describe("the rounding bound (§13.2.6): G = hourly rows before pooling", () => {
  // Four hourly people: Cook {A,B}, Cashier {C,D}.
  const base = [h("p-a", "1", 11), h("p-b", "1", 11), h("p-c", "2", 50), h("p-d", "2", 50)]; // sum 122, G = 4
  it("the packet's literal case (two hourly groups of 10.5 cents, 22 vs 21, G = 2) cannot print: two people make one bucket at most → omitted", () => {
    expect(run([h("p-a", "1", 11), h("p-b", "1", 11)], 21).facts).toEqual({ kind: "omitted" });
  });
  it("two groups of 10.5 cents rounded up (22 vs 21 for those two), G = 4 → labelled", () => {
    expect(run(base, 121).facts).toMatchObject({ kind: "ok", roundedSeparately: true });
  });
  it("an exact match → no label", () => {
    expect(run(base, 122).facts).toMatchObject({ kind: "ok", roundedSeparately: false });
  });
  it("salaried groups never count in G: four hourly + eight salaried, a difference of 3 → unavailable; of 2 → labelled; of 1 → labelled", () => {
    const rows = [...base, ...["p-e", "p-f", "p-g", "p-h", "p-i", "p-j", "p-k", "p-l"].map((k) => sal(k, "1"))];
    expect(run(rows, 119).facts).toEqual({ kind: "unavailable" });
    expect(run(rows, 125).facts).toEqual({ kind: "unavailable" });
    expect(run(rows, 120).facts).toMatchObject({ kind: "ok", roundedSeparately: true });
    expect(run(rows, 121).facts).toMatchObject({ kind: "ok", roundedSeparately: true });
  });
  it("a zero-cent hourly group raises G by one and adds no contributor", () => {
    const five = [h("p-a", "1", 10), h("p-b", "1", 10), h("p-c", "1", 10), h("p-d", "2", 10), h("p-e", "2", 10)]; // G = 5, sum 50
    expect(run(five, 47).facts).toEqual({ kind: "unavailable" }); // 2 × 3 = 6 > 5
    const six = [...five, h("p-f", "1", 0)]; // G = 6
    expect(run(six, 47).facts).toMatchObject({ kind: "ok", roundedSeparately: true }); // 6 ≤ 6
    expect(run(six, 47).sets).toEqual(run(five, 47).sets); // the same contributor sets: p-f is nobody's contributor
    expect(run(six, 47).sets.flatMap((b) => b.contributors)).not.toContain("p-f");
  });
});

describe("property: generated mixes (seeded)", () => {
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }
  const ROLE_KEYS: Array<string | null> = ["1", "2", "3", "4", "5", "6", "0", null, "99"];
  it("over 600 cases: the singleton rules hold, cents add up, order does not matter, no person key in the facts", () => {
    let printedCases = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const rnd = mulberry32(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
      const people = Array.from({ length: 2 + Math.floor(rnd() * 9) }, (_, i) => `person-key-${seed}-${i}-zq`);
      const rows: RolePeopleRow[] = Array.from({ length: Math.floor(rnd() * 22) }, () => {
        const personKey = pick(people);
        const roleKey = pick(ROLE_KEYS);
        const source = rnd() < 0.1 ? "toast" : "7shifts";
        if (rnd() < 0.15) return { personKey, roleKey, source, payClass: "salaried", straightCents: null };
        return { personKey, roleKey, source, payClass: "hourly", straightCents: rnd() < 0.15 ? 0 : Math.floor(rnd() * 5_000) };
      });
      const day = hourlySum(rows);
      const facts = roleBuckets(rows, NAMES, { date: DATE, dayStraightCents: day, wageEstimated: false });
      const sets = roleBucketSetsForTest(rows, NAMES, day);
      expect(["ok", "omitted"]).toContain(facts.kind);
      if (facts.kind === "ok") {
        printedCases++;
        expect(facts.buckets.length).toBeGreaterThanOrEqual(2);
        expect(sets.map(({ kind, name, cents }) => ({ kind, name, cents }))).toEqual(facts.buckets);
        assertNoSingleton(sets);
        // Every hourly row is in exactly one printed bucket.
        expect(facts.buckets.reduce((s, b) => s + b.cents, 0)).toBe(day);
        // The contributors are exactly the people with more than 0 hourly cents somewhere today.
        const paid = new Set(rows.filter((r) => r.payClass === "hourly" && (r.straightCents ?? 0) > 0).map((r) => r.personKey));
        expect(new Set(sets.flatMap((b) => b.contributors)).size).toBeLessThanOrEqual(paid.size);
        for (const k of sets.flatMap((b) => b.contributors)) expect(paid.has(k)).toBe(true);
        for (const b of facts.buckets) expect(Object.keys(b).sort()).toEqual(["cents", "kind", "name"]);
      } else {
        expect(sets).toEqual([]);
      }
      // Any permutation of the rows gives a deep-equal result.
      for (let p = 0; p < 3; p++) {
        const shuffled = [...rows];
        for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]; }
        expect(roleBuckets(shuffled, NAMES, { date: DATE, dayStraightCents: day, wageEstimated: false })).toEqual(facts);
        expect(roleBucketSetsForTest(shuffled, NAMES, day)).toEqual(sets);
      }
      // No person key anywhere in the facts.
      const json = JSON.stringify(facts);
      expect(json).not.toContain("person-key");
      for (const k of people) expect(json).not.toContain(k);
    }
    // The generator must actually exercise the printed path, not only "omitted".
    expect(printedCases).toBeGreaterThan(30);
  });
});
