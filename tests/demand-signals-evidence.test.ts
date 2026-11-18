// Item 4 PR 1: evidence classes, the four times of an input, canonical text.
import { describe, expect, it } from "vitest";
import { assertNoLeak, classifyEvidence, evidenceAllows, readableAt, selectVintage, type InputVintage } from "@/lib/demand-signals/evidence-shared";
import { canonicalJson } from "@/lib/demand-signals/canonical-shared";
import { addressOf, sha256Hex } from "@/lib/demand-signals/hash";
import { prng } from "./helpers/par-engine-fixture";

describe("evidence classes", () => {
  it("a feature unknown at the decision is E0 whatever else is true", () => {
    expect(classifyEvidence({ featureKnownAtDecision: false, replayedFromStoredInputs: true, targetFrozen: true })).toBe("E0");
  });
  it("E2 needs the stored inputs AND the frozen target; anything less is E1", () => {
    expect(classifyEvidence({ featureKnownAtDecision: true, replayedFromStoredInputs: true, targetFrozen: true })).toBe("E2");
    expect(classifyEvidence({ featureKnownAtDecision: true, replayedFromStoredInputs: false, targetFrozen: true })).toBe("E1");
    expect(classifyEvidence({ featureKnownAtDecision: true, replayedFromStoredInputs: true, targetFrozen: false })).toBe("E1");
  });
  it("E0 unlocks nothing, E1 a display, only E2 an action", () => {
    expect([evidenceAllows("E0", "display"), evidenceAllows("E0", "actionable")]).toEqual([false, false]);
    expect([evidenceAllows("E1", "display"), evidenceAllows("E1", "actionable")]).toEqual([true, false]);
    expect([evidenceAllows("E2", "display"), evidenceAllows("E2", "actionable")]).toEqual([true, true]);
  });
});

describe("vintages", () => {
  const v = (id: string, availableAt: string, issuedAt: string | null = null): InputVintage => ({ id, availableAt, issuedAt });
  it("picks the latest row we held at the decision, then the latest issued, then the id", () => {
    const rows = [v("a", "2026-10-01T10:00:00Z", "2026-10-01T09:00:00Z"), v("b", "2026-10-01T12:00:00Z", "2026-10-01T08:00:00Z"),
      v("c", "2026-10-01T12:00:00Z", "2026-10-01T11:00:00Z"), v("d", "2026-10-01T12:00:00Z", "2026-10-01T11:00:00Z"), v("late", "2026-10-02T00:00:00Z")];
    expect(selectVintage(rows, "2026-10-01T12:00:00Z")?.id).toBe("d");
    expect(selectVintage(rows, "2026-10-01T11:59:59Z")?.id).toBe("a");
    expect(selectVintage(rows, "2026-10-01T09:00:00Z")).toBeNull();
  });
  it("a correction that arrived after the decision is never read (the earlier value stands)", () => {
    const rows = [v("order-as-rung", "2026-10-01T22:00:00Z"), v("order-corrected", "2026-10-03T15:00:00Z")];
    expect(selectVintage(rows, "2026-10-02T09:00:00Z")?.id).toBe("order-as-rung");
    expect(() => assertNoLeak(rows, "2026-10-02T09:00:00Z")).toThrow("input_after_decision:order-corrected");
  });
  it("property: whatever the rows, the selected one was held at the decision and no later eligible row was skipped", () => {
    const rand = prng(42);
    const at = () => new Date(Date.UTC(2026, 9, 1) + Math.floor(rand() * 10) * 3_600_000).toISOString();
    for (let round = 0; round < 300; round += 1) {
      const rows: InputVintage[] = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => ({ id: `r${i}`, availableAt: at(), issuedAt: rand() < 0.3 ? null : at() }));
      const decisionAt = at();
      const picked = selectVintage(rows, decisionAt);
      const eligible = rows.filter((r) => readableAt(r, decisionAt));
      if (eligible.length === 0) { expect(picked).toBeNull(); continue; }
      expect(readableAt(picked!, decisionAt)).toBe(true);
      expect(eligible.every((r) => r.availableAt <= picked!.availableAt)).toBe(true);
      expect(() => assertNoLeak([picked!], decisionAt)).not.toThrow();
    }
  });
});

describe("canonical text", () => {
  it("sorts keys, keeps null, drops undefined, and names the same content the same", () => {
    expect(canonicalJson({ b: 1, a: { d: null, c: undefined, e: [2, 1] } })).toBe("{\"a\":{\"d\":null,\"e\":[2,1]},\"b\":1}");
    expect(addressOf({ x: 1, y: 2 }).hash).toBe(addressOf({ y: 2, x: 1 }).hash);
    expect(addressOf({ x: 1 }).hash).toBe(sha256Hex("{\"x\":1}"));
  });
  it("refuses what JSON would silently change", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow("canonical_not_finite:$.a");
    expect(() => canonicalJson({ a: new Map() })).toThrow("canonical_not_plain:$.a");
  });
});
