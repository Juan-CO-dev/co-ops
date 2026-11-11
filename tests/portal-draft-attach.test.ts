// Build 2, A1 (as ruled 2026-11-11): ONLY a Meta continuation token (pipelineId) calls the attach-only
// RPC portal_intake_attach; the plain portal path never touches it (parity is tests/portal-draft-parity).
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn(), inserts: [] as Array<{ table: string; row: Record<string, unknown> }> }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  rpc: mocks.rpc,
  from: (table: string) => ({
    insert: (row: Record<string, unknown>) => {
      mocks.inserts.push({ table, row });
      const id = table === "catering_pipeline" ? "new-lead" : "new-quote";
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

it("a Meta continuation (pipelineId) attaches through the lock-taking RPC: no JS insert, an audit row saying attached", async () => {
  mocks.rpc.mockResolvedValue({ data: { attached: true, quote_id: "quote-1", pipeline_id: LEAD }, error: null });
  expect(await createDraftFromIntake("customer-1", { ...intake, pipelineId: LEAD })).toEqual({ quoteId: "quote-1", pipelineId: LEAD, attached: true });
  expect(mocks.rpc).toHaveBeenCalledWith("portal_intake_attach", { p_customer_id: "customer-1", p_pipeline_id: LEAD, p_intake: { contact_name: "Example Guest", location_id: LOC, event_date: "2027-01-02", headcount: 20, is_delivery: true } });
  expect(mocks.inserts).toEqual([]);
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.draft.create", resourceId: "quote-1", metadata: { pipeline_id: LEAD, customer_id: "customer-1", location_id: LOC, attached: true } }));
});
it("attached=false (not owned / closed / live quote / unknown lead) → today's create path, with today's audit row", async () => {
  mocks.rpc.mockResolvedValue({ data: { attached: false, quote_id: null, pipeline_id: null }, error: null });
  expect(await createDraftFromIntake("customer-1", { ...intake, pipelineId: LEAD })).toEqual({ quoteId: "new-quote", pipelineId: "new-lead", attached: false });
  expect(mocks.inserts.map(i => i.table)).toEqual(["catering_pipeline", "catering_pipeline_events", "catering_quotes"]);
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { pipeline_id: "new-lead", customer_id: "customer-1", location_id: LOC } }));
});
it("no pipelineId → the RPC is never called", async () => {
  expect(await createDraftFromIntake("customer-1", intake)).toEqual({ quoteId: "new-quote", pipelineId: "new-lead", attached: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("a malformed pipelineId is treated as none (never sent to the RPC)", async () => {
  await createDraftFromIntake("customer-1", { ...intake, pipelineId: "lead-id; drop table" });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("a Meta continuation never falls back on an RPC error: it throws by name and writes nothing", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  await expect(createDraftFromIntake("customer-1", { ...intake, pipelineId: LEAD })).rejects.toThrow(/createDraftFromIntake attach: Could not find/);
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "invalid_location" } });
  await expect(createDraftFromIntake("customer-1", { ...intake, pipelineId: LEAD })).rejects.toThrow(/invalid_location/);
  expect(mocks.inserts).toEqual([]);
});
it("a malformed attach result is refused", async () => {
  mocks.rpc.mockResolvedValue({ data: { attached: true, quote_id: 5 }, error: null });
  await expect(createDraftFromIntake("customer-1", { ...intake, pipelineId: LEAD })).rejects.toThrow(/malformed/);
});
