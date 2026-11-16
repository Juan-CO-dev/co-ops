/**
 * Audit W22 (owner decision W22-1: any order update → a customer email showing old vs new). Sending a REVISION
 * of a quote the customer already saw sends "Your catering order was updated" (old → new) instead of the generic
 * quote email — but ONLY when every switch is open. With any switch closed the customer gets exactly today's
 * quote email. `sendEmail` is mocked: no real email is ever sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendQuote } from "@/lib/catering/quotes";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { fakeSupabase } from "./helpers/fake-supabase";

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

const actor = { user: { id: "mgr", role: "catering_mgr" }, role: "catering_mgr", level: 6, locations: ["shop"] } as unknown as AuthContext;
let mode: string;
let version: number;

beforeEach(() => {
  vi.clearAllMocks();
  mode = "live";
  version = 2;
  const fake = fakeSupabase((call) => {
    if (call.table === "catering_quotes" && call.kind === "update") return { count: 1 };
    if (call.table === "catering_quotes" && call.ops.some((o) => o.op === "or")) {
      return { data: { id: "Q1", event_date: "2026-11-20", headcount: 20, total_cents: 50000 } };
    }
    if (call.table === "catering_quotes") {
      return { data: { id: "Q2", root_id: version > 1 ? "Q1" : null, version, location_id: "shop", status: "draft", superseded_at: null, customer_id: "C", total_cents: 61250, deposit_cents: 15000, expires_at: null, event_date: "2026-11-24", headcount: 30 } };
    }
    if (call.table === "catering_customers") return { data: { email: "cust@example.com", name: "Cust", primary_location_id: "shop" } };
    if (call.table === "report_settings") return { data: { value: mode } };
    return { data: null };
  });
  vi.mocked(getServiceRoleClient).mockReturnValue(fake.client as unknown as ReturnType<typeof getServiceRoleClient>);
  process.env.CATERING_ORDER_UPDATE_EMAIL_ALLOWLIST = "*";
  process.env.PORTAL_MAGIC_LINK_ALLOWLIST = "*";
});
afterEach(() => {
  delete process.env.CATERING_ORDER_UPDATE_EMAIL_ALLOWLIST;
  delete process.env.PORTAL_MAGIC_LINK_ALLOWLIST;
});

describe("sendQuote of a revision the customer already saw", () => {
  it("switches open → ONE order-update email listing old vs new, and no generic quote email", async () => {
    const r = await sendQuote(actor, "Q2");
    expect(r.emailed).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(mail.subject).toBe("Your catering order was updated — Compliments Only");
    expect(mail.text).toContain("Event date: Friday, November 20, 2026 → Tuesday, November 24, 2026");
    expect(mail.text).toContain("Guests: 20 → 30");
    expect(mail.text).toContain("Estimated total: $500.00 → $612.50");
    const meta = vi.mocked(audit).mock.calls.map((c) => c[0]).find((a) => a.action === "catering.quote.send")!.metadata;
    expect(meta).toMatchObject({ order_update_email: "sent", email_outcome: "sent" });
  });

  // Fix round 1 (review r1 P2, BC-061): repeated explicit sends of one revision used one key, so the provider
  // swallowed the second. Each send is keyed by the sent_at it writes (the persisted send occurrence).
  it("two explicit sends of one revision get distinct keys, each the sent_at it wrote", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-16T15:00:00.000Z"));
      await sendQuote(actor, "Q2");
      vi.setSystemTime(new Date("2026-11-16T15:05:00.000Z"));
      await sendQuote(actor, "Q2");
    } finally {
      vi.useRealTimers();
    }
    const keys = vi.mocked(sendEmail).mock.calls.map((c) => c[0].idempotencyKey);
    expect(keys).toEqual([
      "order-update:quote:Q1:Q2:2026-11-16T15:00:00.000Z",
      "order-update:quote:Q1:Q2:2026-11-16T15:05:00.000Z",
    ]);
  });

  it("the outbound switch off → exactly today's quote email", async () => {
    mode = "off";
    await sendQuote(actor, "Q2");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0]![0].subject).toBe("Your catering quote from Compliments Only");
  });

  it("the order-update allowlist unset → exactly today's quote email", async () => {
    delete process.env.CATERING_ORDER_UPDATE_EMAIL_ALLOWLIST;
    await sendQuote(actor, "Q2");
    expect(vi.mocked(sendEmail).mock.calls[0]![0].subject).toBe("Your catering quote from Compliments Only");
  });

  it("a first send (v1) → exactly today's quote email", async () => {
    version = 1;
    await sendQuote(actor, "Q2");
    expect(vi.mocked(sendEmail).mock.calls[0]![0].subject).toBe("Your catering quote from Compliments Only");
  });
});
