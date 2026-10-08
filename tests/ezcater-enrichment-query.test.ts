import { describe, expect, it } from "vitest";
import { enrichmentQuery } from "@/lib/ezcater/orders";

const scalar = { kind: "SCALAR", name: "String" };
const schema = (extra: Array<{ name: string; type: typeof scalar; args?: Array<{ type: typeof scalar }> }>) => ({ data: { __schema: {
  queryType: { name: "Root" },
  types: [
    { name: "Root", fields: [{ name: "order", type: { kind: "OBJECT", name: "Order" } }] },
    { name: "Order", fields: extra },
  ],
} } });

const feeSchema = (options: { categories?: string[]; argName?: string; argKind?: string; outputKind?: string; cost?: boolean; otherRequired?: boolean } = {}) => ({ data: { __schema: {
  queryType: { name: "Root" }, types: [
    { name: "Root", fields: [{ name: "order", type: { kind: "OBJECT", name: "Order" } }] },
    { name: "Order", fields: [{ name: "catererCart", type: { kind: "OBJECT", name: "Cart" } }] },
    { name: "Cart", fields: [{ name: "feesAndDiscounts",
      args: [{ name: options.argName ?? "types", type: { kind: "NON_NULL", ofType: {
        kind: options.argKind ?? "LIST", ofType: { kind: "NON_NULL", ofType: { kind: "ENUM", name: "FeeCategory" } },
      } } }, ...(options.otherRequired ? [{ name: "unprovenRequired", type: { kind: "NON_NULL", name: "String" } }] : [])],
      type: { kind: "NON_NULL", ofType: { kind: options.outputKind ?? "LIST", ofType: { kind: "NON_NULL", ofType: { kind: "OBJECT", name: "Fee" } } } },
    }] },
    { name: "FeeCategory", enumValues: (options.categories ?? ["DISCOUNT", "DELIVERY_FEE", "MISC_FEE", "ADJUSTMENT", "POS_INTEGRATION_FEE"]).map((name) => ({ name })) },
    { name: "Fee", fields: options.cost === false ? [] : [{ name: "cost", type: { kind: "OBJECT", name: "Money" } }] },
    { name: "Money", fields: [{ name: "subunits", type: { kind: "SCALAR", name: "Int" } }, { name: "currency", type: scalar }] },
  ],
} } });

describe("introspection gated enrichment selection", () => {
  it("cannot query unproven fields", () => {
    expect(enrichmentQuery({})).toBeNull();
    expect(enrichmentQuery(schema([]))).toBeNull();
  });
  it("adds only schema-confirmed scalar fields to a separate named query", () => {
    const query = enrichmentQuery(schema([{ name: "status", type: scalar }]));
    expect(query).toContain("query orderEnrichment");
    expect(query).toContain("status");
    expect(query).not.toContain("paymentStatus");
    expect(query).not.toContain("contact {");
    expect(query).toContain("subTotal { currency subunits }");
  });
  it("rejects fields requiring an unsupplied argument", () => {
    expect(enrichmentQuery(schema([{ name: "status", type: scalar, args: [{ type: { kind: "NON_NULL", name: "String" } }] }]))).toBeNull();
  });
  it("selects the documented lifecycle/customer and event contact shapes only when introspected", () => {
    const query = enrichmentQuery({ data: { __schema: { queryType: { name: "Root" }, types: [
      { name: "Root", fields: [{ name: "order", type: { kind: "OBJECT", name: "Order" } }] },
      { name: "Order", fields: [
        { name: "lifecycle", type: { kind: "OBJECT", name: "Lifecycle" } },
        { name: "orderCustomer", type: { kind: "OBJECT", name: "Customer" } },
        { name: "event", type: { kind: "OBJECT", name: "Event" } },
      ] },
      { name: "Lifecycle", fields: [{ name: "orderIsCurrently", type: { kind: "ENUM", name: "Status" } }] },
      { name: "Customer", fields: [{ name: "fullName", type: scalar }] },
      { name: "Event", fields: [{ name: "contactPhone", type: scalar }] },
    ] } } });
    expect(query).toContain("lifecycle { orderIsCurrently }");
    expect(query).toContain("orderCustomer { fullName }");
    expect(query).toContain("contactPhone");
    expect(query).not.toContain("contactEmail");
  });
  it("requests categorized fees only after proving argument enums and output Money", () => {
    const query = enrichmentQuery(feeSchema());
    expect(query).toContain("enrichmentDiscounts: feesAndDiscounts(types: [DISCOUNT]) { cost { currency subunits } }");
    expect(query).toContain("enrichmentDeliveryFees: feesAndDiscounts(types: [DELIVERY_FEE])");
    expect(query).toContain("enrichmentMiscFees: feesAndDiscounts(types: [MISC_FEE])");
    expect(query).not.toContain("ADJUSTMENT");
    expect(query).not.toContain("POS_INTEGRATION_FEE");
  });
  it.each([
    { categories: [] }, { argName: "unknown" }, { argKind: "SCALAR" },
    { outputKind: "OBJECT" }, { cost: false }, { otherRequired: true },
  ])("skips fees for unproven schema %j", (options) => {
    expect(enrichmentQuery(feeSchema(options))).toBeNull();
  });
  it("does not fetch a partial fee aggregate when one category is absent", () => {
    const query = enrichmentQuery(feeSchema({ categories: ["DISCOUNT", "DELIVERY_FEE"] }));
    expect(query).toContain("enrichmentDiscounts:");
    expect(query).not.toContain("enrichmentDeliveryFees:");
    expect(query).not.toContain("enrichmentMiscFees:");
  });
});
