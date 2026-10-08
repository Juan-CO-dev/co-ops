/**
 * EZCater order fetch (spec #2c). SERVER-ONLY wrapper over the pure
 * normalizer (lib/ezcater/orders-shared.ts). Query fields mirror the
 * orderByID example in the official guide; the schema supports introspection,
 * so the first-live pass extends fields (contact/delivery address are
 * UNDOCUMENTED unknowns) rather than guessing now.
 */
import "server-only";

import { ezcaterGraphql, EzcaterApiError } from "./client";
import { normalizeEzcaterOrder, type EzcaterOrder } from "./orders-shared";

const ORDER_BY_ID_QUERY = `
query orderByID($id: ID!) {
  order(id: $id) {
    orderNumber
    orderSourceType
    event {
      headcount
      timestamp
      catererHandoffFoodTime
      orderType
    }
    caterer {
      uuid
      name
    }
    totals {
      customerTotalDue { currency subunits }
      subTotal { currency subunits }
      tip { currency subunits }
    }
    catererCart {
      orderItems {
        name
        uuid
        totalInSubunits { subunits currency }
        posItemId
        menuItemSizeId
        quantity
        noteToCaterer
        specialInstructions
        customizations {
          customizationId
          name
          quantity
          customizationTypeName
        }
      }
    }
  }
}`;

interface TypeRef { kind?: string; name?: string | null; ofType?: TypeRef | null }
interface SchemaField { name: string; type: TypeRef; args?: Array<{ name?: string; defaultValue?: string | null; type: TypeRef }> }
interface SchemaType { name: string; fields?: SchemaField[] | null; enumValues?: Array<{ name: string }> | null }
interface SchemaProbe { data?: { __schema?: { queryType?: { name: string }; types?: SchemaType[] } } }

// Runtime schema evidence gates every additional field. No enrichment selection is
// placed in the proven intake query, and probe/enrichment failure is fail-soft.
const PROBE_QUERY = `query enrichmentSchema {
  __schema {
    queryType { name }
    types { name enumValues { name } fields { name args { name defaultValue type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
      type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
    } }
  }
}`;
let cachedProbe: { expires: number; query: string | null } | undefined;

function named(ref: TypeRef | undefined): TypeRef | undefined {
  while (ref?.ofType) ref = ref.ofType;
  return ref;
}

function nullable(ref: TypeRef | null | undefined): TypeRef | undefined {
  return ref?.kind === "NON_NULL" ? ref.ofType ?? undefined : ref ?? undefined;
}

/** Only select fields with proven output shapes and no required arguments. */
export function enrichmentQuery(probe: SchemaProbe): string | null {
  const types = probe.data?.__schema?.types ?? [];
  const fields = (typeName: string | null | undefined) => types.find((t) => t.name === typeName)?.fields ?? [];
  const field = (typeName: string | null | undefined, name: string) => fields(typeName).find((f) =>
    f.name === name && !(f.args ?? []).some((a) => a.type.kind === "NON_NULL" && a.defaultValue == null));
  const queryRoot = probe.data?.__schema?.queryType?.name;
  // order(id:) legitimately has a required argument, supplied by our proven query.
  const orderType = named(fields(queryRoot).find((f) => f.name === "order")?.type)?.name;
  if (!orderType) return null;
  const scalar = (typeName: string | null | undefined, name: string) => {
    const f = field(typeName, name);
    const t = named(f?.type);
    // Lists are not scalar strings/money and must never be queried as such.
    return f && !JSON.stringify(f.type).includes('"LIST"') &&
      (t?.kind === "SCALAR" || t?.kind === "ENUM") ? name : null;
  };
  const money = (typeName: string | null | undefined, name: string) => {
    const f = field(typeName, name);
    if (!f || JSON.stringify(f.type).includes('"LIST"')) return null;
    const t = named(f.type)?.name;
    return scalar(t, "subunits") && scalar(t, "currency") ? `${name} { currency subunits }` : null;
  };
  const rootSelections = [scalar(orderType, "status"), scalar(orderType, "paymentStatus")].filter(Boolean);
  const lifecycleType = named(field(orderType, "lifecycle")?.type)?.name;
  if (scalar(lifecycleType, "orderIsCurrently")) rootSelections.push("lifecycle { orderIsCurrently }");
  const customerType = named(field(orderType, "orderCustomer")?.type)?.name;
  const customer = ["fullName", "email", "phone"].map((f) => scalar(customerType, f)).filter(Boolean);
  if (customer.length) rootSelections.push(`orderCustomer { ${customer.join(" ")} }`);
  const contactField = field(orderType, "contact");
  const contactType = named(contactField?.type)?.name;
  const contact = ["name", "email", "phone", "address"].map((f) => scalar(contactType, f)).filter(Boolean);
  if (contact.length && !JSON.stringify(contactField?.type).includes('"LIST"')) rootSelections.push(`contact { ${contact.join(" ")} }`);
  const eventType = named(field(orderType, "event")?.type)?.name;
  const eventSelections = ["contactName", "contactPhone", "contactEmail"].map((f) => scalar(eventType, f)).filter(Boolean);
  for (const [name, names] of [
    ["contact", ["name", "fullName", "phone", "phoneNumber", "email"]],
    ["address", ["street", "street1", "street2", "city", "state", "zip", "postalCode"]],
  ] as const) {
    const f = field(eventType, name);
    if (!f || JSON.stringify(f.type).includes('"LIST"')) continue;
    const selections = names.map((n) => scalar(named(f.type)?.name, n)).filter(Boolean);
    if (selections.length) eventSelections.push(`${name} { ${selections.join(" ")} }`);
  }
  const totalsType = named(field(orderType, "totals")?.type)?.name;
  const totals = ["salesTax", "fees", "discounts"].map((f) => money(totalsType, f)).filter(Boolean);
  const cartType = named(field(orderType, "catererCart")?.type)?.name;
  const cartSelections: string[] = [];
  // Category aliases are safe only when the actual schema proves the argument
  // list's enum and each output's Money shape. Never infer category from names.
  const feesField = fields(cartType).find((f) => f.name === "feesAndDiscounts");
  const categoryArg = feesField?.args?.find((a) => a.name === "types");
  const categoryList = nullable(categoryArg?.type);
  const categoryType = nullable(categoryList?.ofType);
  const feeList = nullable(feesField?.type);
  const feeType = nullable(feeList?.ofType);
  const otherRequiredArgs = feesField?.args?.some((a) => a.name !== "types" && a.type.kind === "NON_NULL" && a.defaultValue == null);
  if (categoryList?.kind === "LIST" && categoryType?.kind === "ENUM" &&
      feeList?.kind === "LIST" && (feeType?.kind === "OBJECT" || feeType?.kind === "INTERFACE") &&
      !otherRequiredArgs && money(feeType.name, "cost")) {
    const enumValues = new Set(types.find((t) => t.name === categoryType.name)?.enumValues?.map((v) => v.name));
    const select = (alias: string, category: string) => `${alias}: feesAndDiscounts(types: [${category}]) { cost { currency subunits } }`;
    if (enumValues.has("DISCOUNT")) cartSelections.push(select("enrichmentDiscounts", "DISCOUNT"));
    // These two categories define this pass's fees total. An unavailable category
    // leaves the whole total unknown; adjustments and POS fees remain excluded.
    if (enumValues.has("DELIVERY_FEE") && enumValues.has("MISC_FEE")) {
      cartSelections.push(select("enrichmentDeliveryFees", "DELIVERY_FEE"), select("enrichmentMiscFees", "MISC_FEE"));
    }
  }
  const itemType = named(field(cartType, "orderItems")?.type)?.name;
  const unitPrice = money(itemType, "unitPrice");
  if (!rootSelections.length && !totals.length && !unitPrice && !eventSelections.length && !cartSelections.length) return null;
  return ORDER_BY_ID_QUERY.replace("query orderByID", "query orderEnrichment")
    .replace("orderNumber", `orderNumber\n${rootSelections.join("\n")}`)
    .replace("totals {", `totals {\n${totals.join("\n")}`)
    .replace("event {", `event {\n${eventSelections.join("\n")}`)
    .replace("catererCart {", `catererCart {\n${cartSelections.join("\n")}`)
    .replace("menuItemSizeId", `menuItemSizeId\n${unitPrice ?? ""}`);
}

export async function fetchEzcaterOrder(
  orderUuid: string,
  options: { deadlineMs?: number; signal?: AbortSignal } = {},
): Promise<EzcaterOrder> {
  // One bound includes base fetch, introspection, and optional enrichment.
  options = { ...options, deadlineMs: options.deadlineMs ?? Date.now() + 15_000 };
  const json = await ezcaterGraphql<unknown>("orderByID", ORDER_BY_ID_QUERY, { id: orderUuid }, options);
  let base: EzcaterOrder;
  try {
    base = normalizeEzcaterOrder(json);
  } catch {
    throw new EzcaterApiError(502, "bad_payload");
  }
  try {
    if (!cachedProbe || cachedProbe.expires <= Date.now()) {
      const probe = await ezcaterGraphql<SchemaProbe>("enrichmentSchema", PROBE_QUERY, undefined, options);
      cachedProbe = { expires: Date.now() + 300_000, query: enrichmentQuery(probe) };
    }
    if (cachedProbe.query) {
      const query = cachedProbe.query;
      const enriched = normalizeEzcaterOrder(await ezcaterGraphql<unknown>("orderEnrichment", query, { id: orderUuid }, options));
      const selections = {
        status: "\nstatus", paymentStatus: "\npaymentStatus", contact: "contact {",
        taxCents: "salesTax {", feesCents: "fees {", discountsCents: "discounts {", itemUnitPrice: "unitPrice {",
      };
      const enrichmentFields = Object.entries(selections).filter(([, selection]) => query.includes(selection)).map(([name]) => name);
      if (query.includes("enrichmentDiscounts:") && !enrichmentFields.includes("discountsCents")) enrichmentFields.push("discountsCents");
      if (query.includes("enrichmentDeliveryFees:") && query.includes("enrichmentMiscFees:") && !enrichmentFields.includes("feesCents")) enrichmentFields.push("feesCents");
      if (query.includes("orderIsCurrently") && !enrichmentFields.includes("status")) enrichmentFields.push("status");
      if (["orderCustomer {", "contactName", "contactPhone", "contactEmail", "address {"].some((s) => query.includes(s)) && !enrichmentFields.includes("contact")) enrichmentFields.push("contact");
      return { ...enriched, enrichmentAvailable: true,
        enrichmentFields,
      };
    }
  } catch {
    // Unknown schema fields, provider outages and missing probe fixtures cannot
    // poison intake. The next sweep will retry with the proven base available.
  }
  return base;
}
