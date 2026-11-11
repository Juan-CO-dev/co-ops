// Build 2, A1: createDraftFromIntake → portal_intake_apply (attach-to-lead under the customer intake
// lock), with the legacy JS path only when 0300 is not applied and no lead is being continued.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn(), inserts: [] as Array<{ table: string; row: Record<string, unknown> }> }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  rpc: mocks.rpc,
  from: (table: string) => ({
    insert: (row: Record<string, unknown>) => {
      mocks.inserts.push({ table, row });
      const id = table === "catering_pipeline" ? "legacy-lead" : "legacy-quote";
      return { select: () => ({ single: async () => ({ data: { id }, error: null }) }), then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
    },
  }),
}) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/portal/menu", () => ({ loadPublicCateringMenu: vi.fn(), loadPublicCateringPackages: vi.fn(), loadPublicPricingContext: vi.fn() }));
vi.mock("@/lib/catering/payments", () => ({ createPaymentDue: vi.fn() }));
import { createDraftFromIntake } from "@/lib/portal/draft";

const LOC = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const intake = { locationId: LOC, contactName: " Example Guest ", email: "buyer@work.example", company: "Work", eventDate: "2027-01-02", headcount: 20, isDelivery: true, contactPhone: "+12025550100" };
beforeEach(() => { mocks.rpc.mockReset(); mocks.audit.mockReset(); mocks.inserts.length = 0; });

it("a Meta continuation (pipelineId) goes through the lock-taking RPC and reports the attach", async () => {
  mocks.rpc.mockResolvedValue({ data: { quote_id: "quote-1", pipeline_id: LEAD, attached: true }, error: null });
  expect(await createDraftFromIntake("customer-1", { ...intake, pipelineId: LEAD })).toEqual({ quoteId: "quote-1", pipelineId: LEAD, attached: true });
  expect(mocks.rpc).toHaveBeenCalledWith("portal_intake_apply", { p_customer_id: "customer-1", p_pipeline_id: LEAD, p_intake: expect.objectContaining({
    contact_name: "Example Guest", location_id: LOC, is_delivery: true, event_date: "2027-01-02", headcount: 20, contact_phone: "+12025550100", company: "Work", fulfillment_routed: false,
  }) });
  expect(mocks.inserts).toEqual([]);
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.draft.create", resourceId: "quote-1", metadata: expect.objectContaining({ pipeline_id: LEAD, attached: true }) }));
});
it("the RPC's create branch (no lead, or a lead that no longer qualifies) is reported as not attached", async () => {
  mocks.rpc.mockResolvedValue({ data: { quote_id: "quote-2", pipeline_id: "new-lead", attached: false }, error: null });
  expect(await createDraftFromIntake("customer-1", { ...intake, pipelineId: LEAD })).toEqual({ quoteId: "quote-2", pipelineId: "new-lead", attached: false });
});
it("a malformed pipelineId is never sent to the RPC", async () => {
  mocks.rpc.mockResolvedValue({ data: { quote_id: "q", pipeline_id: "p", attached: false }, error: null });
  await createDraftFromIntake("customer-1", { ...intake, pipelineId: "lead-id; drop table" });
  expect(mocks.rpc).toHaveBeenCalledWith("portal_intake_apply", expect.objectContaining({ p_pipeline_id: null }));
});
it.each([{ code: "PGRST202", message: "Could not find the function public.portal_intake_apply" }, { code: "42883", message: "function does not exist" }])("before 0300 is applied (%j) a plain portal intake falls back to today's inserts", async error => {
  mocks.rpc.mockResolvedValue({ data: null, error });
  expect(await createDraftFromIntake("customer-1", intake)).toEqual({ quoteId: "legacy-quote", pipelineId: "legacy-lead", attached: false });
  expect(mocks.inserts.map(i => i.table)).toEqual(["catering_pipeline", "catering_pipeline_events", "catering_quotes"]);
  expect(mocks.inserts[0]!.row).toMatchObject({ contact_name: "Example Guest", lead_source: "portal", stage: "inquiry", location_id: LOC, customer_id: "customer-1" });
  expect(mocks.inserts[2]!.row).toMatchObject({ pipeline_id: "legacy-lead", status: "draft", origin: "self_serve", is_delivery: true });
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ legacy_path: true }) }));
});
it("a Meta continuation never falls back: without the RPC it throws (0300 precedes enabling Meta leads)", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  await expect(createDraftFromIntake("customer-1", { ...intake, pipelineId: LEAD })).rejects.toThrow(/createDraftFromIntake rpc/);
  expect(mocks.inserts).toEqual([]);
});
it("any other RPC refusal throws by name and writes nothing", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "invalid_location" } });
  await expect(createDraftFromIntake("customer-1", intake)).rejects.toThrow(/invalid_location/);
  expect(mocks.inserts).toEqual([]);
});
it("a malformed RPC result is refused", async () => {
  mocks.rpc.mockResolvedValue({ data: { quote_id: 5 }, error: null });
  await expect(createDraftFromIntake("customer-1", intake)).rejects.toThrow(/malformed/);
});
