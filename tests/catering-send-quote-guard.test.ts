/**
 * Audit W22/B204 — sendQuote's status write is guarded on the status it validated. A concurrent
 * accept that lands between sendQuote's read and its write is no longer flipped back to 'sent',
 * and the customer gets no re-send email.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendQuote, CateringQuoteError } from "@/lib/catering/quotes";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import type { AuthContext } from "@/lib/session";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "mock-email" })) }));
vi.mock("@/lib/catering/payment-carry", () => ({
  reconcileFamilyPayments: vi.fn(async () => ({ attempted: false })),
  carryPaymentsToRevision: vi.fn(),
  retireSessionFor: vi.fn(),
}));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn(async () => ({ all: true })) }));
vi.mock("@/lib/catering/ezcater-detail-shared", () => ({ canReadCateringContact: () => true }));

const actor = {
  user: { id: "mgr-b", role: "catering_mgr" },
  role: "catering_mgr",
  level: 6,
  locations: ["shop"],
} as unknown as AuthContext;

let updateCount: number;
let calls: FakeCall[];

beforeEach(() => {
  vi.clearAllMocks();
  updateCount = 1;
  const fake = fakeSupabase((call) => {
    if (call.table === "catering_quotes" && call.kind === "update") return { count: updateCount };
    if (call.table === "catering_quotes") {
      return { data: { id: "Q", root_id: null, location_id: "shop", status: "sent", superseded_at: null, customer_id: "C", total_cents: 10000, deposit_cents: 2500, expires_at: null, version: 1 } };
    }
    if (call.table === "catering_customers") return { data: { email: "cust@example.com", name: "Cust", primary_location_id: "shop" } };
    return { data: null };
  });
  calls = fake.calls;
  vi.mocked(getServiceRoleClient).mockReturnValue(fake.client as unknown as ReturnType<typeof getServiceRoleClient>);
});

describe("B204: sendQuote's status write", () => {
  it("is guarded on the status the read validated", async () => {
    await sendQuote(actor, "Q");
    const upd = calls.find((c) => c.table === "catering_quotes" && c.kind === "update")!;
    expect(upd.has("eq", "status", "sent")).toBe(true);
    expect(upd.has("eq", "id", "Q")).toBe(true);
  });

  it("a lost race is 409 status_changed, and no email is sent", async () => {
    updateCount = 0;
    const err = await sendQuote(actor, "Q").catch((e) => e);
    expect(err).toBeInstanceOf(CateringQuoteError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("status_changed");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
