/**
 * Unit spine — lib/toast/matcher.ts (pure crosswalk matcher, Toast read-track 1).
 * Pins: name normalization, exact-match ceiling, token-set partials, the price
 * bonus, the 0.8 candidate threshold, greedy one-per-side uniqueness, and
 * determinism — the contract the admin confirm queue depends on.
 */
import { describe, it, expect } from "vitest";
import { normalizeName, matchCandidates, type CoEntity, type ToastItem } from "@/lib/toast/matcher";

function co(name: string, priceCents: number | null = null, id = name): CoEntity {
  return { kind: "menu_item", id, name, priceCents };
}
function toast(name: string, priceCents: number | null = null, itemGuid = `g-${name}`): ToastItem {
  return { itemGuid, name, priceCents, groupName: null };
}

describe("normalizeName", () => {
  it("lowercases, strips diacritics and punctuation, collapses whitespace", () => {
    expect(normalizeName("  Jalapeño—Crunch,  Sub!  ")).toBe("jalapeno crunch sub");
    expect(normalizeName("HOT PANTS")).toBe("hot pants");
  });
});

describe("matchCandidates", () => {
  it("exact normalized name scores 1.0", () => {
    const [m] = matchCandidates([co("Hot Pants")], [toast("hot  pants!")]);
    expect(m).toBeDefined();
    expect(m!.score).toBeCloseTo(1.0, 10);
  });

  it("partial token overlap scores by Jaccard and can clear the threshold", () => {
    // tokens {italian, sub} vs {italian, sub, large}: J = 2/3 ≈ 0.667 → below 0.8 alone
    const below = matchCandidates([co("Italian Sub")], [toast("Italian Sub Large")]);
    expect(below).toHaveLength(0);
    // with agreeing prices the +0.15 bonus lifts it over: 0.667+0.15 = 0.817
    const lifted = matchCandidates([co("Italian Sub", 1200)], [toast("Italian Sub Large", 1210)]);
    expect(lifted).toHaveLength(1);
    expect(lifted[0]!.score).toBeGreaterThan(0.8);
  });

  it("price bonus applies only within 5% and never lifts past 0.99", () => {
    const far = matchCandidates([co("Italian Sub", 1200)], [toast("Italian Sub Large", 2000)]);
    expect(far).toHaveLength(0); // no bonus — price disagreement
    const exact = matchCandidates([co("Meatball", 1000)], [toast("Meatball", 1000)]);
    expect(exact[0]!.score).toBeCloseTo(1.0, 10); // exact name stays 1.0, not 1.15
  });

  it("greedy uniqueness: one candidate per entity and per toast item", () => {
    const out = matchCandidates(
      [co("Turkey Sub", 1100, "A"), co("Turkey Club", 1100, "B")],
      [toast("Turkey Sub", 1100, "t1")],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.entity.id).toBe("A"); // exact beats partial
  });

  it("is deterministic under input reordering", () => {
    const es = [co("Caesar Wrap", 900, "e1"), co("Caesar Salad", 900, "e2")];
    const ts = [toast("Caesar Salad", 905, "t2"), toast("Caesar Wrap", 895, "t1")];
    const a = matchCandidates(es, ts).map((m) => `${m.entity.id}:${m.toast.itemGuid}`);
    const b = matchCandidates([...es].reverse(), [...ts].reverse()).map((m) => `${m.entity.id}:${m.toast.itemGuid}`);
    expect(a.sort()).toEqual(b.sort());
    expect(a).toContain("e1:t1");
    expect(a).toContain("e2:t2");
  });

  it("returns empty on empty inputs", () => {
    expect(matchCandidates([], [toast("X")])).toEqual([]);
    expect(matchCandidates([co("X")], [])).toEqual([]);
  });
});
