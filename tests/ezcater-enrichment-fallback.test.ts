import { beforeEach, describe, expect, it, vi } from "vitest";

const { graphql } = vi.hoisted(() => ({ graphql: vi.fn() }));
vi.mock("@/lib/ezcater/client", () => ({
  ezcaterGraphql: graphql,
  EzcaterApiError: class extends Error {
    constructor(public status: number, public code: string) { super(code); }
  },
}));

const base = { data: { order: { orderNumber: "TEST", totals: { subTotal: { subunits: 1200 }, tip: { subunits: 100 } } } } };
const probe = { data: { __schema: { queryType: { name: "Root" }, types: [
  { name: "Root", fields: [{ name: "order", type: { kind: "OBJECT", name: "Order" } }] },
  { name: "Order", fields: [{ name: "status", type: { kind: "ENUM", name: "Status" } }] },
] } } };

beforeEach(() => { vi.resetModules(); graphql.mockReset(); });

describe("optional enrichment cannot poison proven intake", () => {
  it("returns base when the probe is unavailable", async () => {
    graphql.mockResolvedValueOnce(base).mockRejectedValueOnce(new Error("probe unavailable"));
    const { fetchEzcaterOrder } = await import("@/lib/ezcater/orders");
    const result = await fetchEzcaterOrder("uuid");
    expect(result.subtotalCents).toBe(1200);
    expect(result.tipCents).toBe(100);
    expect(result.enrichmentAvailable).toBe(false);
    expect(result.enrichmentFields).toEqual([]);
    expect(graphql.mock.calls[0]?.[0]).toBe("orderByID");
    expect(graphql.mock.calls[0]?.[1]).not.toContain("paymentStatus");
  });
  it("returns base on enriched GraphQL errors after a successful probe", async () => {
    graphql.mockResolvedValueOnce(base).mockResolvedValueOnce(probe).mockRejectedValueOnce(new Error("graphql_error"));
    const { fetchEzcaterOrder } = await import("@/lib/ezcater/orders");
    expect((await fetchEzcaterOrder("uuid")).orderNumber).toBe("TEST");
    expect(graphql.mock.calls.map((call) => call[0])).toEqual(["orderByID", "enrichmentSchema", "orderEnrichment"]);
  });
  it("uses enrichment when available and bounds all calls by the same deadline", async () => {
    graphql.mockResolvedValueOnce(base).mockResolvedValueOnce(probe)
      .mockResolvedValueOnce({ data: { order: { ...base.data.order, status: "CANCELLED" } } });
    const { fetchEzcaterOrder } = await import("@/lib/ezcater/orders");
    const deadlineMs = Date.now() + 1000;
    expect(await fetchEzcaterOrder("uuid", { deadlineMs })).toMatchObject({ status: "CANCELLED", enrichmentAvailable: true, enrichmentFields: ["status"] });
    for (const call of graphql.mock.calls) expect(call[3]).toMatchObject({ deadlineMs });
  });
  it("reports malformed base as a fixed code without reflecting data", async () => {
    graphql.mockResolvedValueOnce({ data: { order: { orderNumber: "X", catererCart: { orderItems: [{ name: "private@example.test" }] } } } });
    const { fetchEzcaterOrder } = await import("@/lib/ezcater/orders");
    await expect(fetchEzcaterOrder("uuid")).rejects.toThrow("bad_payload");
    expect(graphql).toHaveBeenCalledTimes(1);
  });
});
