// REVIEW RULING 2026-11-11 (P2-1): with no pipelineId the live portal path is BYTE-IDENTICAL to before
// build 2. This runs the BASE createDraftFromIntake (3a5b1ad8, verbatim fixture) and the live one against
// the same recorder for the same inputs — active shop, inactive shop (the DB accepts the FK either way;
// no new refusal), a Meta token whose attach was refused — and demands identical writes + audit.
import { beforeEach, expect, it, vi } from "vitest";
const rec = vi.hoisted(() => ({ writes: [] as Array<{ table: string; row: Record<string, unknown> }>, audits: [] as unknown[], rpc: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  rpc: rec.rpc,
  from: (table: string) => ({
    insert: (row: Record<string, unknown>) => {
      rec.writes.push({ table, row });
      const id = `${table}-${rec.writes.length}`;
      return { select: () => ({ single: async () => ({ data: { id }, error: null }) }), then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
    },
  }),
}) }));
vi.mock("@/lib/audit", () => ({ audit: (row: unknown) => { rec.audits.push(row); } }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/portal/menu", () => ({ loadPublicCateringMenu: vi.fn(), loadPublicCateringPackages: vi.fn(), loadPublicPricingContext: vi.fn() }));
vi.mock("@/lib/catering/payments", () => ({ createPaymentDue: vi.fn() }));
import { createDraftFromIntake } from "@/lib/portal/draft";
import { createDraftFromIntakeBase } from "./fixtures/portal/draft-create-base";

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const INACTIVE = "33333333-3333-4333-8333-333333333333";
const LEAD = "22222222-2222-4222-8222-222222222222";
const inputs: Array<[string, Parameters<typeof createDraftFromIntake>[1]]> = [
  ["active shop, full intake", { locationId: ACTIVE, contactName: " Guest ", email: "g@example.test", company: "Co", eventDate: "2027-01-02", headcount: 20, isDelivery: true, deliveryAddress: "1 St", contactPhone: "+1202", timeWindow: "11-12", eventType: "Lunch", dietaryNotes: "None", eventName: "Offsite", dropoffDoor: "Side", geoLat: 38.9, geoLng: -77, fulfillmentRouted: true }],
  ["inactive shop (no new refusal — the FK is the only check, as before)", { locationId: INACTIVE, contactName: "Guest", isDelivery: false }],
  ["sparse intake, zero headcount", { locationId: ACTIVE, contactName: "Guest", headcount: 0, isDelivery: false, company: null, eventDate: null }],
];
async function record(run: () => Promise<unknown>) {
  rec.writes.length = 0; rec.audits.length = 0;
  const result = await run();
  return { writes: structuredClone(rec.writes), audits: structuredClone(rec.audits), result };
}
beforeEach(() => { rec.rpc.mockReset(); rec.writes.length = 0; rec.audits.length = 0; });

it.each(inputs)("%s → identical writes, identical audit row, no RPC", async (_label, intake) => {
  const base = await record(() => createDraftFromIntakeBase("customer-1", intake));
  const live = await record(() => createDraftFromIntake("customer-1", intake));
  expect(live.writes).toEqual(base.writes);
  expect(live.audits).toEqual(base.audits);
  expect(live.writes.map(w => w.table)).toEqual(["catering_pipeline", "catering_pipeline_events", "catering_quotes"]);
  expect(live.audits[0]).toMatchObject({ action: "catering.draft.create", metadata: { pipeline_id: "catering_pipeline-1", customer_id: "customer-1", location_id: intake.locationId } });
  expect(Object.keys((live.audits[0] as { metadata: object }).metadata).sort()).toEqual(["customer_id", "location_id", "pipeline_id"]);
  expect(rec.rpc).not.toHaveBeenCalled();
  expect(live.result).toMatchObject(base.result as object);
});
it.each([["invalid location", { locationId: "nope", contactName: "G", isDelivery: false }], ["blank name", { locationId: ACTIVE, contactName: "  ", isDelivery: false }], ["negative headcount", { locationId: ACTIVE, contactName: "G", headcount: -1, isDelivery: false }]])("refusal parity: %s", async (_label, intake) => {
  const base = await createDraftFromIntakeBase("customer-1", intake).catch(e => e);
  const live = await createDraftFromIntake("customer-1", intake).catch(e => e);
  expect(live).toMatchObject({ status: base.status, code: base.code, message: base.message });
  expect(rec.writes).toEqual([]); expect(rec.rpc).not.toHaveBeenCalled();
});
it("a Meta token whose attach is refused (attached=false) then takes EXACTLY the base path", async () => {
  rec.rpc.mockResolvedValue({ data: { attached: false, quote_id: null, pipeline_id: null }, error: null });
  const intake = inputs[0]![1];
  const base = await record(() => createDraftFromIntakeBase("customer-1", intake));
  const live = await record(() => createDraftFromIntake("customer-1", { ...intake, pipelineId: LEAD }));
  expect(live.writes).toEqual(base.writes); expect(live.audits).toEqual(base.audits);
  expect(rec.rpc).toHaveBeenCalledTimes(1);
});
