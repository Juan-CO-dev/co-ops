/**
 * Catering delivery D1 — the recorded 10 / 90 gratuity split (plan r6 section 4.5, Juan's decision 4). `splitGratuity`
 * is pinned against the same case file the SQL twin (delivery_gratuity_split) runs in scripts/sql-harness-0356.mjs.
 * RECORDED ONLY: nothing here pays anything.
 */
import { describe, expect, it } from "vitest";
import cases from "./fixtures/delivery/gratuity-split-cases.json";
import { allocationOf, splitGratuity, splitHead } from "@/lib/delivery/gratuity-shared";
import { DEFAULT_GRATUITY_DRIVER_BPS, type DeliveryGratuitySplit } from "@/lib/delivery/types-shared";

describe("splitGratuity equals the shared case file", () => {
  it("has enough cases, valid and invalid", () => {
    expect(cases.length).toBeGreaterThanOrEqual(27);
    expect(cases.some((c) => "invalid" in c)).toBe(true);
  });

  it.each(cases.map((c) => [`${c.gratuityCents} @ ${c.driverBps}`, c] as const))("%s", (_name, c) => {
    if ("invalid" in c) { expect(() => splitGratuity(c.gratuityCents, c.driverBps)).toThrow("bad_gratuity"); return; }
    const got = splitGratuity(c.gratuityCents, c.driverBps);
    expect(got).toEqual({ driverCents: c.driverCents, crewCents: c.crewCents });
    expect(got.driverCents + got.crewCents).toBe(c.gratuityCents);
  });
});

describe("the rule", () => {
  it("Juan's sentence: 10% to the driver, 90% to the crew; half a cent rounds up to the driver", () => {
    expect(DEFAULT_GRATUITY_DRIVER_BPS).toBe(1000);
    expect(splitGratuity(10000, DEFAULT_GRATUITY_DRIVER_BPS)).toEqual({ driverCents: 1000, crewCents: 9000 });
    expect(splitGratuity(5, 1000)).toEqual({ driverCents: 1, crewCents: 4 });
    expect(splitGratuity(4, 1000)).toEqual({ driverCents: 0, crewCents: 4 });
  });

  it("refuses a fraction of a cent or of a basis point", () => {
    expect(() => splitGratuity(10.5, 1000)).toThrow("bad_gratuity");
    expect(() => splitGratuity(100, 12.5)).toThrow("bad_gratuity");
    expect(() => splitGratuity(Number.NaN, 1000)).toThrow("bad_gratuity");
  });
});

describe("the order's allocation is the HEAD of its chain", () => {
  const row = (id: string, over: Partial<DeliveryGratuitySplit> = {}): DeliveryGratuitySplit => ({
    id, pipelineId: "lead", jobId: "j1", quoteId: "q", kind: "split", gratuityCents: 10000, driverBps: 1000, driverCents: 1000, crewCents: 9000,
    recordedAt: "2026-11-22T10:00:00Z", recordedBy: null, reason: null, supersedesId: null, ...over });

  it("one $100 gratuity, two delivered jobs: the head credits job 2 and the order allocates $100 once", () => {
    const rows = [row("s1"), row("s2", { jobId: "j2", supersedesId: "s1" })];
    expect(splitHead(rows)?.id).toBe("s2");
    expect(splitHead([...rows].reverse())?.id).toBe("s2");
    expect(allocationOf(splitHead(rows))).toEqual({ jobId: "j2", gratuityCents: 10000, driverBps: 1000, driverCents: 1000, crewCents: 9000 });
  });

  it("a void head, a zero head and no head allocate nothing", () => {
    expect(splitHead([])).toBeNull();
    expect(allocationOf(null)).toBeNull();
    expect(allocationOf(row("v", { kind: "void", jobId: null, gratuityCents: 0, driverCents: 0, crewCents: 0, supersedesId: "s1" }))).toBeNull();
    expect(allocationOf(row("z", { gratuityCents: 0, driverCents: 0, crewCents: 0 }))).toBeNull();
  });
});
