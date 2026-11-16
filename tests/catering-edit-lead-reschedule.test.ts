/**
 * Audit W22/B120 — rescheduling a lead moves the customer's quote date and the reserved kitchen prep with it
 * (0329 reschedule_catering_lead), a confirmed order cannot lose its date, and the customer is told what
 * changed by a NEW email that ships CLOSED (every send switch must be open). No real email is ever sent:
 * `sendEmail` is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editLead, CateringPipelineError } from "@/lib/catering/pipeline";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { orderChanges, orderUpdateDelivery, renderOrderUpdateEmail } from "@/lib/catering/order-update-email-shared";
import type { AuthContext } from "@/lib/session";
import { fakeSupabase, type FakeCall, type FakeRpc } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "mock-email" })) }));

const actor = { user: { id: "mgr", role: "catering_mgr" }, role: "catering_mgr", level: 6, locations: ["shop"] } as unknown as AuthContext;

let calls: FakeCall[];
let rpcs: FakeRpc[];
let lead: Record<string, unknown>;
let mode: string;
let rpcAnswer: { data?: unknown; error?: unknown };

function install() {
  const fake = fakeSupabase((call) => {
    if (call.table === "catering_pipeline" && call.kind === "update") return { count: 1 };
    if (call.table === "catering_pipeline") return { data: lead };
    if (call.table === "catering_quotes") return { data: { id: "Q" } };
    if (call.table === "report_settings") return { data: { value: mode } };
    if (call.table === "catering_customers") return { data: { name: "Dana <Admin>", email: "Dana@Example.com" } };
    return { data: null };
  }, () => rpcAnswer);
  calls = fake.calls;
  rpcs = fake.rpcs;
  vi.mocked(getServiceRoleClient).mockReturnValue(fake.client as unknown as ReturnType<typeof getServiceRoleClient>);
}

const saved = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  lead = { id: "L", location_id: "shop", event_date: "2026-11-20", stage: "confirmed", customer_id: "C", assigned_to: null };
  mode = "off";
  rpcAnswer = { data: { result: "moved", from_date: "2026-11-20", to_date: "2026-11-24", quote_updated: true, prep_rows_moved: 3 } };
  delete process.env.CATERING_ORDER_UPDATE_EMAIL_ALLOWLIST;
  delete process.env.PORTAL_MAGIC_LINK_ALLOWLIST;
  install();
});
afterEach(() => { process.env = { ...saved }; });

const editAudit = () => vi.mocked(audit).mock.calls.map((c) => c[0]).find((a) => a.action === "catering.pipeline.edit")!;

describe("B120: reschedule moves the quote and the prep", () => {
  it("a changed eventDate calls reschedule_catering_lead and does not patch event_date directly", async () => {
    await editLead(actor, "L", { eventDate: "2026-11-24" });
    expect(rpcs).toEqual([{ name: "reschedule_catering_lead", args: { p_lead_id: "L", p_event_date: "2026-11-24", p_actor_id: "mgr" } }]);
    const patch = calls.find((c) => c.table === "catering_pipeline" && c.kind === "update")!.arg("update") as Record<string, unknown>;
    expect("event_date" in patch).toBe(false);
    expect(editAudit().metadata).toMatchObject({ fields: ["event_date"], event_date_changed: true, event_date_from: "2026-11-20", event_date_to: "2026-11-24", quote_date_updated: true, prep_rows_moved: 3 });
  });

  it("clearing the date on a confirmed lead is 409 event_date_required_confirmed, nothing written", async () => {
    const err = await editLead(actor, "L", { eventDate: null }).catch((e) => e);
    expect(err).toBeInstanceOf(CateringPipelineError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("event_date_required_confirmed");
    expect(rpcs).toHaveLength(0);
    expect(calls.some((c) => c.kind === "update")).toBe(false);
  });

  it("clearing the date on an inquiry keeps today's behaviour: a plain patch, no RPC", async () => {
    lead.stage = "inquiry";
    await editLead(actor, "L", { eventDate: null });
    expect(rpcs).toHaveLength(0);
    const patch = calls.find((c) => c.table === "catering_pipeline" && c.kind === "update")!.arg("update") as Record<string, unknown>;
    expect(patch.event_date).toBeNull();
  });

  it("a malformed date is refused before any write", async () => {
    const err = await editLead(actor, "L", { eventDate: "11/24/2026" }).catch((e) => e);
    expect(err.code).toBe("invalid_payload");
    expect(rpcs).toHaveLength(0);
  });

  it("before 0329 is applied the same steps run one call at a time", async () => {
    rpcAnswer = { error: { code: "PGRST202", message: "Could not find the function" } };
    await editLead(actor, "L", { eventDate: "2026-11-24" });
    const quoteWrites = calls.filter((c) => c.table === "catering_quotes" && c.kind === "update");
    expect(quoteWrites.length).toBe(2);
    expect(quoteWrites.every((c) => c.has("is", "superseded_at", null))).toBe(true);
    expect(calls.some((c) => c.table === "catering_pipeline_events" && c.kind === "insert")).toBe(true);
  });
});

describe("B120: the customer email (NEW, ships closed)", () => {
  it("with the switches closed (the shipped default) nothing is sent; the reason is audited", async () => {
    await editLead(actor, "L", { eventDate: "2026-11-24" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(editAudit().metadata).toMatchObject({ customer_email: "suppressed", customer_email_reason: "email_off" });
  });

  it("live mode but no order-update allowlist → still nothing sent", async () => {
    mode = "live";
    process.env.PORTAL_MAGIC_LINK_ALLOWLIST = "*";
    await editLead(actor, "L", { eventDate: "2026-11-24" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(editAudit().metadata).toMatchObject({ customer_email: "suppressed", customer_email_reason: "allowlist_closed" });
  });

  it("every switch open → ONE email (mocked) showing old vs new, with an idempotency key", async () => {
    mode = "live";
    process.env.CATERING_ORDER_UPDATE_EMAIL_ALLOWLIST = "*";
    process.env.PORTAL_MAGIC_LINK_ALLOWLIST = "*";
    await editLead(actor, "L", { eventDate: "2026-11-24" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(mail.to).toBe("dana@example.com");
    expect(mail.subject).toBe("Your catering order was updated — Compliments Only");
    expect(mail.text).toContain("Event date: Friday, November 20, 2026 → Tuesday, November 24, 2026");
    expect(mail.html).toContain("Dana &lt;Admin&gt;");
    expect(mail.idempotencyKey).toBe("order-update:L:2026-11-20:2026-11-24");
    expect(editAudit().metadata).toMatchObject({ customer_email: "sent" });
  });

  it("no email when the date did not move (unchanged) or the lead has no quote", async () => {
    mode = "live";
    process.env.CATERING_ORDER_UPDATE_EMAIL_ALLOWLIST = "*";
    process.env.PORTAL_MAGIC_LINK_ALLOWLIST = "*";
    await editLead(actor, "L", { eventDate: "2026-11-20" }); // same date: no reschedule at all
    expect(rpcs).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("the order-update email (pure)", () => {
  it("delivery: closed unless every switch is open, first closed switch is the reason", () => {
    const base = { deliveryMode: "live", allowlist: "*", portalAllowlist: "*", email: "a@x.com" };
    expect(orderUpdateDelivery(base)).toEqual({ deliver: true });
    expect(orderUpdateDelivery({ ...base, deliveryMode: "preview" })).toEqual({ deliver: false, reason: "email_off" });
    expect(orderUpdateDelivery({ ...base, deliveryMode: null })).toEqual({ deliver: false, reason: "email_off" });
    expect(orderUpdateDelivery({ ...base, allowlist: undefined })).toEqual({ deliver: false, reason: "allowlist_closed" });
    expect(orderUpdateDelivery({ ...base, allowlist: "  " })).toEqual({ deliver: false, reason: "allowlist_closed" });
    expect(orderUpdateDelivery({ ...base, allowlist: "b@x.com" })).toEqual({ deliver: false, reason: "not_allowlisted" });
    expect(orderUpdateDelivery({ ...base, portalAllowlist: "b@x.com" })).toEqual({ deliver: false, reason: "portal_allowlist" });
  });

  it("the exact template text (en)", () => {
    const mail = renderOrderUpdateEmail({
      name: "Dana",
      tenantName: "Compliments Only",
      changes: orderChanges({ eventDate: "2026-11-20" }, { eventDate: "2026-11-24" }),
      orderUrl: "https://order.example.com/order/quote/Q",
    });
    expect(mail.subject).toBe("Your catering order was updated — Compliments Only");
    expect(mail.text).toBe([
      "Hi Dana,",
      "",
      "We updated your catering order. Here's what changed:",
      "",
      "Event date: Friday, November 20, 2026 → Tuesday, November 24, 2026",
      "",
      "Everything else on your order stays the same.",
      "",
      "View your order: https://order.example.com/order/quote/Q (sign-in required).",
      "",
      "If this doesn't look right, reply to this email and we'll sort it out.",
    ].join("\n"));
  });

  it("changes list only what differs: guests and total too", () => {
    expect(orderChanges({ eventDate: "2026-11-20", headcount: 20, totalCents: 50000 }, { eventDate: "2026-11-20", headcount: 30, totalCents: 61250 })).toEqual([
      { label: "Guests", from: "20", to: "30" },
      { label: "Estimated total", from: "$500.00", to: "$612.50" },
    ]);
  });
});
