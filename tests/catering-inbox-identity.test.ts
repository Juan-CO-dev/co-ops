import { describe, it, expect, vi } from "vitest";
import { resolveCateringInboxIdentity } from "@/lib/catering/inbox-identity";
import { inboxExternalReference } from "@/lib/catering/inbox-identity-shared";

function service(rows: Record<string, unknown[][]>) {
  const calls: Array<[string, string, unknown[]]> = [];
  const from = vi.fn((table: string) => {
    const result = { data: rows[table]?.shift() ?? [], error: null };
    const query: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ["select", "ilike", "eq", "neq", "not", "in", "is", "limit", "returns"]) {
      query[method] = (...args: unknown[]) => { calls.push([table, method, args]); return query; };
    }
    return query;
  });
  return { sb: { from } as unknown as Parameters<typeof resolveCateringInboxIdentity>[1], calls, from };
}
const input = { sender: "guest_name@example.com", threadKey: null, externalRef: null, messageId: "message" };
const lead = { id: "lead", customer_id: "customer", location_id: "shop", stage: "inquiry", assigned_to: null };
describe("attach-only inbox identity", () => {
  it("trims and lowercases the sender before literal ILIKE, including wildcard escapes", async () => {
    const { sb, calls } = service({});
    await resolveCateringInboxIdentity({ ...input, sender: "  Guest_Name%tag@example.COM  " }, sb);
    expect(calls).toContainEqual(["catering_customers", "ilike", ["email", "guest\\_name\\%tag@example.com"]]);
  });
  it("never uses the invalid threading marker for an identity lookup", async () => {
    const { sb, from } = service({ catering_customers: [[{ id: "customer", active: true }]] });
    await resolveCateringInboxIdentity({ ...input, threadKey: "[invalid]" }, sb);
    expect(from).not.toHaveBeenCalledWith("catering_inbound_messages");
  });
  it.each([
    [[], "new_sender"], [[{ id: "customer", active: false }], "ambiguous"],
    [[{ id: "customer", active: true }, { id: "old", active: false }], "ambiguous"],
  ])("does not attach absent/inactive/duplicate contacts %j", async (customers, identity) => {
    const { sb, calls } = service({ catering_customers: [customers as unknown[]] });
    expect(await resolveCateringInboxIdentity(input, sb)).toMatchObject({ identity, customerId: null });
    expect(calls).toContainEqual(["catering_customers", "ilike", ["email", "guest\\_name@example.com"]]);
  });
  it("attaches one active contact and its current quote family", async () => {
    const { sb, calls } = service({ catering_customers: [[{ id: "customer", active: true }]], catering_pipeline: [[lead]], catering_quotes: [[{ id: "quote" }]] });
    expect(await resolveCateringInboxIdentity(input, sb)).toMatchObject({ identity: "resolved", leadId: "lead", quoteId: "quote", artifact: "resolved" });
    expect(calls).toContainEqual(["catering_quotes", "is", ["superseded_at", null]]);
    expect(calls).toContainEqual(["catering_quotes", "eq", ["customer_id", "customer"]]);
  });
  it("keeps multiple open leads ambiguous", async () => {
    const { sb } = service({ catering_customers: [[{ id: "customer", active: true }]], catering_pipeline: [[lead, { ...lead, id: "other" }]] });
    expect(await resolveCateringInboxIdentity(input, sb)).toMatchObject({ artifact: "ambiguous", leadId: null });
  });
  it("keeps multiple current quotes ambiguous", async () => {
    const { sb } = service({ catering_customers: [[{ id: "customer", active: true }]], catering_pipeline: [[lead]], catering_quotes: [[{ id: "one" }, { id: "two" }]] });
    expect(await resolveCateringInboxIdentity(input, sb)).toMatchObject({ artifact: "ambiguous", quoteId: null });
  });
  it("revalidates a thread's customer ownership before using its lead", async () => {
    const { sb, calls } = service({ catering_customers: [[{ id: "customer", active: true }]], catering_inbound_messages: [[{ lead_id: "old" }]], catering_pipeline: [[], [lead]], catering_quotes: [[]] });
    expect(await resolveCateringInboxIdentity({ ...input, threadKey: "thread" }, sb)).toMatchObject({ leadId: null, artifact: "ambiguous" });
    expect(calls).toContainEqual(["catering_pipeline", "eq", ["customer_id", "customer"]]);
  });
  it("never queries a customer for relay or platform email", async () => {
    for (const sender of ["relay+123@example.com", "orders@tripleseat.com", "order@ezcater.com"]) {
      const { sb, from } = service({});
      expect(await resolveCateringInboxIdentity({ ...input, sender }, sb)).toMatchObject({ identity: "masked", customerId: null });
      expect(from).not.toHaveBeenCalled();
    }
  });
  it("validates platform source and external reference without inventing a contact", async () => {
    const { sb, calls } = service({ catering_pipeline: [[lead]], catering_quotes: [[]] });
    expect(await resolveCateringInboxIdentity({ ...input, sender: "order@ezcater.com", externalRef: "provider-id" }, sb)).toMatchObject({ identity: "masked", customerId: null, leadId: "lead" });
    expect(calls).toContainEqual(["catering_pipeline", "eq", ["lead_source", "ezcater"]]);
    expect(calls).toContainEqual(["catering_pipeline", "eq", ["external_ref", "provider-id"]]);
    expect(calls).toContainEqual(["catering_pipeline", "in", ["stage", ["inquiry", "quote_sent", "confirmed", "out"]]]);
  });
  it("uses IS NULL for a proven platform family without a customer", async () => {
    const { sb, calls } = service({ catering_pipeline: [[{ ...lead, customer_id: null }]], catering_quotes: [[{ id: "quote" }]] });
    expect(await resolveCateringInboxIdentity({ ...input, sender: "orders@ezcater.com", externalRef: "provider-id" }, sb))
      .toMatchObject({ customerId: null, leadId: "lead", quoteId: "quote" });
    expect(calls).toContainEqual(["catering_quotes", "is", ["customer_id", null]]);
  });
  it("extracts only one provider UUID candidate on an ezCater domain", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(inboxExternalReference("orders@ezcater.com", "Order", id)).toBe(id);
    expect(inboxExternalReference("orders@ezcater.com.attacker.net", "Order", id)).toBeNull();
    expect(inboxExternalReference("orders@ezcater.com", "Order #1234", "")).toBeNull();
    expect(inboxExternalReference("orders@ezcater.com", id, "22222222-2222-4222-8222-222222222222")).toBeNull();
  });
});
