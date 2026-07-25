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
  it("lowercases, strips diacritics and punctuation, collapses whitespace (+ plural fold)", () => {
    expect(normalizeName("  Jalapeño—Crunch,  Sub!  ")).toBe("jalapeno crunch sub");
    expect(normalizeName("HOT PANTS")).toBe("hot pant"); // symmetric fold — both sides agree
  });

  it("folds simple plurals so Onions≡Onion, Tomatoes≡Tomato (queue-clearing class)", () => {
    expect(normalizeName("Onions")).toBe(normalizeName("Onion"));
    expect(normalizeName("Tomatoes")).toBe(normalizeName("Tomato")); // -oes fold
    expect(normalizeName("Cucumbers")).toBe(normalizeName("Cucumber"));
    expect(normalizeName("Swiss")).toBe("swiss"); // double-s never folds
    expect(normalizeName("Vin")).toBe("vin");     // short tokens never fold
  });

  it("plural pairs now score exact through the matcher", () => {
    const out = matchCandidates([co("Onion", null, "on")], [toast("Onions", null, "t-on")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBeCloseTo(1.0, 10);
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

  it("greedy uniqueness: one candidate per TOAST ITEM (exact beats partial)", () => {
    const out = matchCandidates(
      [co("Turkey Sub", 1100, "A"), co("Turkey Club", 1100, "B")],
      [toast("Turkey Sub", 1100, "t1")],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.entity.id).toBe("A");
  });

  it("multi-guid reality: one entity pairs with EVERY exact-name channel variant", () => {
    // Toast models channel-priced variants as distinct items (first-light 2026-07-24):
    // mainline $15.79, Grubhub $16.50, specials $12 — same food, three guids.
    const out = matchCandidates(
      [co("Hot Pants", 1579, "hp")],
      [toast("Hot Pants", 1579, "t-main"), toast("Hot Pants", 1650, "t-grubhub"), toast("Hot Pants", 1200, "t-special")],
    );
    expect(out).toHaveLength(3);
    expect(new Set(out.map((m) => m.entity.id))).toEqual(new Set(["hp"]));
    expect(new Set(out.map((m) => m.toast.itemGuid)).size).toBe(3);
    expect(out.every((m) => m.score >= 0.999)).toBe(true);
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
