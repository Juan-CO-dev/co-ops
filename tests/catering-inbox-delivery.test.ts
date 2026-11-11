import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/session";
import {
  buildInboxEscalation, inboxCronEligible, inboxDeliveryConfig, inboxDeliveryOutcome, inboxReplyThreading, inboxSendable, inboxStaffUrl, renderInboxReply, senderAddress, textToHtml,
} from "@/lib/catering/inbox-delivery-shared";
import { inboxOwnAddresses } from "@/lib/catering/inbox-content-shared";
import { claimEscalation, claimReply, fakeInboxService, ids, liveEnv, type Row } from "./fixtures/catering-inbox/fake-service";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

describe("delivery switches and pure rules", () => {
  const env = { CATERING_INBOX_DELIVERY_ENABLED: "1", CATERING_INBOX_FROM: "Catering <catering@example.test>", EMAIL_FROM_TEAM: "team@example.test", RESEND_API_KEY: "re_x" };
  it("needs live mode AND the flag AND both explicit senders AND a provider key, with no fallback", () => {
    expect(inboxDeliveryConfig("live", env)).toEqual({ ok: true, replyFrom: "Catering <catering@example.test>", replyAddress: "catering@example.test", teamFrom: "team@example.test", teamAddress: "team@example.test" });
    for (const mode of ["off", "shadow", null, undefined] as const) expect(inboxDeliveryConfig(mode, env)).toEqual({ ok: false, code: "delivery_off" });
    for (const flag of [undefined, "", "0", "true", "1 "]) expect(inboxDeliveryConfig("live", { ...env, CATERING_INBOX_DELIVERY_ENABLED: flag })).toEqual({ ok: false, code: "delivery_off" });
    for (const broken of [{ CATERING_INBOX_FROM: undefined }, { CATERING_INBOX_FROM: "" }, { CATERING_INBOX_FROM: "catering@" }, { CATERING_INBOX_FROM: "a@b.test\r\nBcc: x@y.test" },
      { EMAIL_FROM_TEAM: undefined }, { EMAIL_FROM_TEAM: "Team <>" }, { RESEND_API_KEY: "" }, { RESEND_API_KEY: undefined }]) {
      expect(inboxDeliveryConfig("live", { ...env, ...broken }), JSON.stringify(broken)).toEqual({ ok: false, code: "not_configured" });
    }
  });
  it("parses a bare address or a display name, never a header injection", () => {
    expect(senderAddress("Catering <Catering@Example.test>")).toBe("catering@example.test");
    expect(senderAddress(" catering@example.test ")).toBe("catering@example.test");
    for (const bad of ["", "x", "<a@b.test> extra", "a@b.test, c@d.test", "Name <a@b.test>\nX: y", "a b@c.test", null, undefined]) expect(senderAddress(bad)).toBeNull();
  });
  it("maps provider answers: id → sent, a CONFIRMED 4xx rejection → failed, everything unknown stays uncertain", () => {
    expect(inboxDeliveryOutcome({ id: "e1" })).toEqual({ outcome: "sent", providerId: "e1" });
    for (const code of ["validation_error", "missing_required_field", "invalid_from_address", "rate_limit_exceeded", "daily_quota_exceeded", "invalid_access"])
      expect(inboxDeliveryOutcome({ error: "nope", code }), code).toEqual({ outcome: "failed", code: "provider_rejected" });
    expect(inboxDeliveryOutcome({ error: "bad", code: "invalid_threading" })).toEqual({ outcome: "failed", code: "send_failed" });
    // Timeouts, network errors, 5xx, "no id", the same key still processing, an unknown name: uncertain, never failed.
    for (const result of [{ error: "socket hang up" }, { error: "send returned no id" }, { error: "boom", code: "internal_server_error" }, { error: "boom", code: "application_error" },
      { error: "processing", code: "concurrent_idempotent_requests" }, { error: "new", code: "some_future_error_name" }])
      expect(inboxDeliveryOutcome(result), JSON.stringify(result)).toEqual({ outcome: "ambiguous", code: "provider_uncertain" });
    expect(inboxDeliveryOutcome({ error: "mismatch", code: "invalid_idempotent_request" })).toEqual({ outcome: "ambiguous", code: "idempotency_conflict" });
  });
  it("threads on the inbound Message-ID and keeps only well-formed references", () => {
    expect(inboxReplyThreading({ "message-id": "<a@x.test>", references: "<r1@x.test> junk <r2@x.test>" })).toEqual({ inReplyTo: "<a@x.test>", references: ["<r1@x.test>", "<r2@x.test>", "<a@x.test>"] });
    expect(inboxReplyThreading({ "message-id": "[invalid]", references: "[invalid]" })).toEqual({});
    expect(inboxReplyThreading({})).toEqual({});
  });
  it("renders the reviewed subject and an escaped HTML part from the frozen text", () => {
    const t = (key: string, params?: Record<string, string>) => ((en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (m, n: string) => params?.[n] ?? m);
    const mail = renderInboxReply({ templateKey: "third_party", params: { channel: "ezCater" }, previewText: "Hi <b>there</b>,\n\nLine two\nLine three", translate: t });
    expect(mail.subject).toBe("Help with your ezCater order");
    expect(mail.text).toBe("Hi <b>there</b>,\n\nLine two\nLine three");
    expect(mail.html).toBe("<p>Hi &lt;b&gt;there&lt;/b&gt;,</p>\n<p>Line two<br>Line three</p>");
    expect(textToHtml("a & b")).toBe("<p>a &amp; b</p>");
  });
  it.each(["en", "es"] as const)("builds a frozen staff escalation in %s with the plain inbox link and no customer link", language => {
    const dict = (language === "en" ? en : es) as Record<string, string>;
    const t = (key: string, params?: Record<string, string>) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (m, n: string) => params?.[n] ?? m);
    const envelope = buildInboxEscalation({ language, tenantName: "Synthetic", inboxUrl: inboxStaffUrl("https://staff.example.test"), reason: "urgent", sender: "guest@example.test", subject: "Help\r\nnow", translate: t });
    expect(envelope).toMatchObject({ language, params: { tenantName: "Synthetic", reason: "urgent", inboxUrl: "https://staff.example.test/catering/inbox" } });
    expect(envelope.preview_text).toContain(dict["catering.inbox.reason.urgent"]);
    expect(envelope.preview_text).toContain("Help now");
    expect(envelope.preview_text).not.toMatch(/token|\/order/);
    expect(buildInboxEscalation({ language, tenantName: "S", inboxUrl: inboxStaffUrl("http://staff.example.test"), reason: "urgent", sender: null, subject: "", translate: t }).params).not.toHaveProperty("inboxUrl");
    expect(inboxStaffUrl("https://staff.example.test/path")).toBeNull();
  });
  it("cron eligibility: unsent always, failed after the backoff while under the attempt cap, nothing else", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(inboxCronEligible({ delivery_state: "draft", delivery_attempt: 0, delivery_attempted_at: null }, now)).toBe(true);
    expect(inboxCronEligible({ delivery_state: "failed", delivery_attempt: 1, delivery_attempted_at: "2026-11-11T11:55:00Z" }, now)).toBe(false);
    expect(inboxCronEligible({ delivery_state: "failed", delivery_attempt: 1, delivery_attempted_at: "2026-11-11T11:45:00Z" }, now)).toBe(true);
    expect(inboxCronEligible({ delivery_state: "failed", delivery_attempt: 3, delivery_attempted_at: "2026-11-11T10:00:00Z" }, now)).toBe(false);
    for (const state of ["claimed", "sent", "ambiguous", "cancelled"] as const) expect(inboxCronEligible({ delivery_state: state, delivery_attempt: 1, delivery_attempted_at: null }, now)).toBe(false);
  });
  it("sendable only in live mode on a drafted message with an unsent or failed reply draft", () => {
    expect(inboxSendable({ mode: "live", disposition: "drafted", hasDraft: true, deliveryState: "draft" })).toBe(true);
    expect(inboxSendable({ mode: "live", disposition: "drafted", hasDraft: true, deliveryState: "failed" })).toBe(true);
    expect(inboxSendable({ mode: "shadow", disposition: "drafted", hasDraft: true, deliveryState: "draft" })).toBe(false);
    expect(inboxSendable({ mode: "live", disposition: "needs_human", hasDraft: false, deliveryState: null })).toBe(false);
    for (const state of ["claimed", "sent", "ambiguous", "cancelled"] as const) expect(inboxSendable({ mode: "live", disposition: "drafted", hasDraft: true, deliveryState: state })).toBe(false);
  });
  it("the inbox sender joins own-address suppression, display name stripped", () => {
    const own = inboxOwnAddresses({ aliases: [], receiptAddresses: [], inboxFrom: "Catering <Catering@Example.test>" });
    expect(own.has("catering@example.test")).toBe(true);
  });
});

const runtime = vi.hoisted(() => ({ sendEmail: vi.fn(), audit: vi.fn(), client: vi.fn(), lease: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: runtime.sendEmail }));
vi.mock("@/lib/audit", () => ({ audit: runtime.audit }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: runtime.client }));
vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: runtime.lease }));
vi.mock("@/lib/session", () => ({ requireSession: runtime.session }));
import { runCateringInboxDelivery, sendCateringInboxDraft } from "@/lib/catering/inbox-delivery";
import { setCateringInboxMode } from "@/lib/catering/inbox-settings";
import { POST as send } from "@/app/api/catering/inbox/[id]/send/route";
import { POST as settings } from "@/app/api/admin/catering-inbox/settings/route";
import { GET as cron } from "@/app/api/cron/catering-inbox-delivery/route";

const actor = { user: { id: ids.actor, role: "catering_mgr", active: true }, session: { id: ids.actor } } as AuthContext;
const owner = { user: { id: ids.actor, role: "owner", active: true }, session: { id: ids.actor, stepUpUnlocked: true, stepUpUnlockedAt: new Date().toISOString() } } as unknown as AuthContext;
function liveTables(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    users: [{ id: ids.actor, role: "catering_mgr", active: true, language: "en" }, { id: ids.assignee, role: "catering_mgr", active: true, language: "es" }],
    user_locations: [], inbound_address_aliases: [], locations: [],
    catering_inbox_settings: [{ singleton: true, mode: "live", revision: 2, live_since: "2026-11-11T00:00:00Z" }],
    catering_inbound_messages: [
      { id: ids.message, location_id: null, sender_address: "guest@example.test", headers: { "message-id": "<inbound-1@example.test>" }, disposition: "drafted", recorded_at: "2026-11-11T01:00:00Z", assigned_to: null, reason: null, subject: "Need catering" },
      { id: ids.escalation, location_id: null, sender_address: "angry@example.test", headers: {}, disposition: "needs_human", recorded_at: "2026-11-11T02:00:00Z", assigned_to: ids.assignee, reason: "urgent", subject: "Urgente" },
      { id: "99999999-9999-4999-8999-999999999999", location_id: null, sender_address: "old@example.test", headers: {}, disposition: "needs_human", recorded_at: "2026-11-10T02:00:00Z", assigned_to: ids.assignee, reason: "urgent", subject: "Old" },
    ],
    catering_inbox_drafts: [
      { id: ids.draft, message_id: ids.message, kind: "reply", delivery_state: "draft", delivery_attempt: 0, delivery_attempted_at: null, created_at: "2026-11-11T01:00:00Z", preview_text: "x" },
      { id: "88888888-8888-4888-8888-888888888888", message_id: "99999999-9999-4999-8999-999999999999", kind: "reply", delivery_state: "draft", delivery_attempt: 0, delivery_attempted_at: null, created_at: "2026-11-10T01:00:00Z", preview_text: "old" },
    ],
    ...extra,
  };
}
function request(url: string, body?: unknown, origin: string | null = "https://tenant.example", headers: Record<string, string> = {}) {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (origin) h.origin = origin;
  return new NextRequest(url, { method: body === undefined ? "GET" : "POST", headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(() => { for (const [key, value] of Object.entries(liveEnv)) vi.stubEnv(key, value); vi.stubEnv("CRON_SECRET", "cron-secret"); runtime.lease.mockResolvedValue(true); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("the delivery worker (cron path)", () => {
  it("sends NEW arrivals only: a reply from the inbox sender and an escalation from team@ in the assignee's language; old drafts are left alone", async () => {
    const claims: Record<string, unknown>[] = [];
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === "sweep_catering_inbox_delivery") return { data: [], error: null };
      if (name === "catering_inbox_delivery_due") return { data: { replies: [{ message_id: ids.message, draft_id: ids.draft }], escalations: [{ message_id: ids.escalation }] }, error: null };
      if (name === "claim_catering_inbox_delivery") { claims.push(args); return { data: args.p_kind === "reply" ? claimReply() : claimEscalation(), error: null }; }
      if (name === "finish_catering_inbox_delivery") return { data: { revision: 3 }, error: null };
      throw new Error(`Unexpected writer: ${name}`);
    });
    const { sb } = fakeInboxService({ tables: liveTables(), rpc });
    runtime.sendEmail.mockResolvedValue({ id: "p" });
    const run = await runCateringInboxDelivery({ service: sb, now: new Date("2026-11-11T12:00:00Z") });
    expect(run).toEqual({ ran: true, swept: 0, replies: { attempted: 1, sent: 1, failed: 0, ambiguous: 0, skipped: 0 }, escalations: { attempted: 1, sent: 1, failed: 0, ambiguous: 0, skipped: 0 } });
    expect(claims.map(c => [c.p_message_id, c.p_kind, c.p_trigger, c.p_actor_id])).toEqual([[ids.message, "reply", "cron", null], [ids.escalation, "escalation", "cron", null]]);
    expect(claims[1]!.p_escalation).toMatchObject({ language: "es", params: { tenantName: expect.any(String), reason: "urgent", inboxUrl: "https://staff.example.test/catering/inbox" } });
    expect((claims[1]!.p_escalation as { preview_text: string }).preview_text).toContain(es["catering.inbox.reason.urgent"]);
    expect(runtime.sendEmail).toHaveBeenCalledTimes(2);
    expect(runtime.sendEmail.mock.calls[0]![0]).toMatchObject({ to: "guest@example.test", from: "Catering <catering@example.test>", idempotencyKey: `catering-inbox:${ids.draft}:1` });
    expect(runtime.sendEmail.mock.calls[1]![0]).toMatchObject({ to: "keith@example.test", from: "team@example.test", subject: es["catering.inbox.escalation.email_subject"] });
    expect(runtime.sendEmail.mock.calls[1]![0]).not.toHaveProperty("inReplyTo");
    expect(runtime.audit.mock.calls.map(([input]) => input.action)).toEqual(["catering.inbox.delivery_sent", "catering.inbox.delivery_sent"]);
  });
  it("a named SQL refusal is a skip, not a crash; a retry of a failed escalation sends no new envelope", async () => {
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === "sweep_catering_inbox_delivery") return { data: [], error: null };
      if (name === "catering_inbox_delivery_due") return { data: { replies: [{ message_id: ids.message, draft_id: ids.draft }], escalations: [{ message_id: ids.escalation }] }, error: null };
      if (name === "claim_catering_inbox_delivery") return args.p_kind === "reply" ? { data: null, error: { message: "thread_cap" } } : { data: claimEscalation(2), error: null };
      return { data: { revision: 3 }, error: null };
    });
    const { sb } = fakeInboxService({ tables: liveTables({ catering_inbox_drafts: [
      { id: ids.draft, message_id: ids.message, kind: "reply", delivery_state: "draft", delivery_attempt: 0, delivery_attempted_at: null, created_at: "2026-11-11T01:00:00Z", preview_text: "x" },
      { id: "7", message_id: ids.escalation, kind: "escalation", delivery_state: "failed", delivery_attempt: 1, delivery_attempted_at: "2026-11-11T11:00:00Z", created_at: "2026-11-11T02:00:00Z", preview_text: "y" },
    ] }), rpc });
    runtime.sendEmail.mockResolvedValue({ error: "refused", code: "validation_error" });
    const run = await runCateringInboxDelivery({ service: sb, now: new Date("2026-11-11T12:00:00Z") });
    expect(run.replies).toEqual({ attempted: 1, sent: 0, failed: 0, ambiguous: 0, skipped: 1 });
    expect(run.escalations).toEqual({ attempted: 1, sent: 0, failed: 1, ambiguous: 0, skipped: 0 });
    expect(rpc.mock.calls.find(([name, args]) => name === "claim_catering_inbox_delivery" && (args as Record<string, unknown>).p_kind === "escalation")![1]).toMatchObject({ p_escalation: null });
    expect(rpc).toHaveBeenCalledWith("finish_catering_inbox_delivery", expect.objectContaining({ p_outcome: "failed", p_error_code: "provider_rejected" }));
  });
  it("the cron route: secret → switches → lease → run; busy lease skips; a thrown run is a fixed-code failure", async () => {
    const { sb } = fakeInboxService({ tables: liveTables(), rpc: (name) => name === "sweep_catering_inbox_delivery" ? { data: [], error: null }
      : name === "catering_inbox_delivery_due" ? { data: { replies: [{ message_id: ids.message, draft_id: ids.draft }], escalations: [{ message_id: ids.escalation }] }, error: null }
      : { data: null, error: { message: "invalid_state" } } });
    runtime.client.mockReturnValue(sb);
    expect((await cron(request("https://tenant.example/api/cron/catering-inbox-delivery"))).status).toBe(401);
    runtime.lease.mockResolvedValueOnce(false);
    expect(await (await cron(request("https://tenant.example/api/cron/catering-inbox-delivery", undefined, null, { authorization: "Bearer cron-secret" }))).json()).toEqual({ skipped: true, reason: "cron_route_busy" });
    const ok = await cron(request("https://tenant.example/api/cron/catering-inbox-delivery", undefined, null, { authorization: "Bearer cron-secret" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ replies: { attempted: 1, skipped: 1 }, escalations: { attempted: 1, skipped: 1 } });
    expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: expect.objectContaining({ job: "catering-inbox-delivery" }) }));
    expect(runtime.sendEmail).not.toHaveBeenCalled();
    runtime.client.mockReturnValue(fakeInboxService({ tables: { catering_inbox_settings: [] } }).sb);
    const failed = await cron(request("https://tenant.example/api/cron/catering-inbox-delivery", undefined, null, { authorization: "Bearer cron-secret" }));
    expect(failed.status).toBe(500);
    expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: { job: "catering-inbox-delivery", error: "delivery_route_failed" } }));
  });
});

describe("review round: uncertainty, starvation, the expiry sweep", () => {
  it("timeout → same-key retry answers concurrent_idempotent_requests → ambiguous; the finish never says failed, so no later attempt mints a new key", async () => {
    const finishes: Record<string, unknown>[] = [];
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === "claim_catering_inbox_delivery") return { data: claimReply(), error: null };
      finishes.push(args); return { data: { revision: 3 }, error: null };
    });
    runtime.client.mockReturnValue(fakeInboxService({ tables: liveTables(), rpc }).sb);
    runtime.sendEmail.mockResolvedValueOnce({ error: "timeout" }).mockResolvedValueOnce({ error: "still processing", code: "concurrent_idempotent_requests" });
    expect(await sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).toMatchObject({ state: "ambiguous" });
    expect(runtime.sendEmail).toHaveBeenCalledTimes(2);
    expect(runtime.sendEmail.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([`catering-inbox:${ids.draft}:1`, `catering-inbox:${ids.draft}:1`]);
    expect(finishes).toEqual([{ p_draft_id: ids.draft, p_token: "token-1", p_outcome: "ambiguous", p_provider_id: null, p_error_code: "provider_uncertain" }]);
    // Timeout, then the retry is REJECTED (rate limit): the first request may still have been delivered → stays ambiguous.
    runtime.sendEmail.mockReset().mockResolvedValueOnce({ error: "timeout" }).mockResolvedValueOnce({ error: "slow down", code: "rate_limit_exceeded" });
    expect(await sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).toMatchObject({ state: "ambiguous" });
    expect(finishes.at(-1)).toMatchObject({ p_outcome: "ambiguous", p_error_code: "provider_uncertain" });
    // Timeout, then the retry CONFIRMS under the same key → sent with that id.
    runtime.sendEmail.mockReset().mockResolvedValueOnce({ error: "timeout" }).mockResolvedValueOnce({ id: "provider-late" });
    expect(await sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).toMatchObject({ state: "sent" });
    expect(finishes.at(-1)).toMatchObject({ p_outcome: "sent", p_provider_id: "provider-late" });
    expect(runtime.sendEmail.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([`catering-inbox:${ids.draft}:1`, `catering-inbox:${ids.draft}:1`]);
    // A same-key conflict (different payload) is not retried at all and is a conflict for a person.
    runtime.sendEmail.mockReset().mockResolvedValue({ error: "mismatch", code: "invalid_idempotent_request" });
    expect(await sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).toMatchObject({ state: "ambiguous" });
    expect(runtime.sendEmail).toHaveBeenCalledTimes(1);
    expect(finishes.at(-1)).toMatchObject({ p_outcome: "ambiguous", p_error_code: "idempotency_conflict" });
    expect(runtime.audit.mock.calls.map(([input]) => input.action).filter(a => a.startsWith("catering.inbox.delivery_"))).toEqual(["catering.inbox.delivery_ambiguous", "catering.inbox.delivery_ambiguous", "catering.inbox.delivery_sent", "catering.inbox.delivery_ambiguous"]);
  });
  it("the worker attempts exactly the SQL-filtered queue — never a page walk — so predecessors cannot hide newer rows (the >250 case is proven in the 0298 harness)", async () => {
    const uuid = (n: number, tag: string) => `${tag}${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;
    const messages: Row[] = [], drafts: Row[] = [];
    for (let n = 0; n < 300; n++) {
      messages.push({ id: uuid(n, "a"), location_id: null, sender_address: `old${n}@example.test`, headers: {}, disposition: "handled", recorded_at: "2026-11-11T01:00:00Z", assigned_to: null, reason: null, subject: "old" });
      drafts.push({ id: uuid(n, "b"), message_id: uuid(n, "a"), kind: "reply", delivery_state: "draft", delivery_attempt: 0, delivery_attempted_at: null, created_at: "2026-11-11T01:00:00Z", preview_text: "x" });
    }
    const fresh = uuid(1, "f"), freshEsc = uuid(2, "f");
    messages.push({ id: fresh, location_id: null, sender_address: "new@example.test", headers: {}, disposition: "drafted", recorded_at: "2026-11-11T03:00:00Z", assigned_to: null, reason: null, subject: "new" });
    drafts.push({ id: uuid(3, "f"), message_id: fresh, kind: "reply", delivery_state: "draft", delivery_attempt: 0, delivery_attempted_at: null, created_at: "2026-11-11T03:00:00Z", preview_text: "x" });
    messages.push({ id: freshEsc, location_id: null, sender_address: "angry@example.test", headers: {}, disposition: "needs_human", recorded_at: "2026-11-11T03:00:00Z", assigned_to: ids.assignee, reason: "urgent", subject: "new esc" });
    const claims: Record<string, unknown>[] = [];
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === "sweep_catering_inbox_delivery") return { data: [], error: null };
      if (name === "catering_inbox_delivery_due") { expect(args).toEqual({ p_limit: 25 }); return { data: { replies: [{ message_id: fresh, draft_id: uuid(3, "f") }], escalations: [{ message_id: freshEsc }] }, error: null }; }
      if (name === "claim_catering_inbox_delivery") {
        claims.push(args);
        return { data: args.p_message_id === fresh ? claimReply(1, { message_id: fresh }) : claimEscalation(1, { message_id: freshEsc }), error: null };
      }
      return { data: { revision: 3 }, error: null };
    });
    const { sb, from } = fakeInboxService({ tables: liveTables({ catering_inbound_messages: messages, catering_inbox_drafts: drafts }), rpc });
    runtime.sendEmail.mockResolvedValue({ id: "p" });
    const run = await runCateringInboxDelivery({ service: sb, now: new Date("2026-11-11T12:00:00Z") });
    expect(claims.map(c => [c.p_message_id, c.p_kind])).toEqual([[fresh, "reply"], [freshEsc, "escalation"]]);
    expect(claims[1]!.p_escalation).toMatchObject({ language: "es", params: { reason: "urgent" } });
    expect(run.replies).toEqual({ attempted: 1, sent: 1, failed: 0, ambiguous: 0, skipped: 0 });
    expect(run.escalations).toEqual({ attempted: 1, sent: 1, failed: 0, ambiguous: 0, skipped: 0 });
    expect(runtime.sendEmail).toHaveBeenCalledTimes(2);
    // No lane list read, no page walk: the only draft/message reads are the per-attempt lookups.
    expect(from.mock.calls.filter(([table]) => table === "catering_inbox_drafts").length).toBeLessThanOrEqual(1);
  });
  it("the cron sweeps expired claims first: each becomes an audited ambiguous row and nothing is resent", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "sweep_catering_inbox_delivery") return { data: [{ draft_id: ids.draft, message_id: ids.message, kind: "reply", attempt: 2, trigger: "cron" }], error: null };
      if (name === "claim_catering_inbox_delivery") return { data: null, error: { message: "needs_review" } };
      return { data: { revision: 3 }, error: null };
    });
    const { sb } = fakeInboxService({ tables: liveTables({ catering_inbox_drafts: [{ id: ids.draft, message_id: ids.message, kind: "reply", delivery_state: "claimed", delivery_attempt: 2, delivery_attempted_at: "2026-11-11T11:00:00Z", created_at: "2026-11-11T01:00:00Z", preview_text: "x" }] }), rpc });
    const run = await runCateringInboxDelivery({ service: sb, now: new Date("2026-11-11T12:00:00Z") });
    expect(run.swept).toBe(1);
    expect(rpc.mock.calls[0]).toEqual(["sweep_catering_inbox_delivery", { p_limit: 25 }]);
    expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.inbox.delivery_ambiguous", resourceId: ids.draft,
      metadata: expect.objectContaining({ error_code: "lease_expired", swept: true, attempt: 2, trigger: "cron" }) }));
    expect(runtime.sendEmail).not.toHaveBeenCalled();
    expect(run.replies.attempted).toBe(0);
  });
});

describe("the human routes", () => {
  it("send: same-origin before the session, Tier B before the body, a closed payload, library errors preserved", async () => {
    const { sb } = fakeInboxService({ tables: liveTables(), rpc: () => ({ data: null, error: { message: "thread_cap" } }) });
    runtime.client.mockReturnValue(sb);
    const params = { params: Promise.resolve({ id: ids.message }) };
    const body = { expectedRevision: 1, requestId: ids.request };
    expect((await send(request(`https://tenant.example/api/catering/inbox/${ids.message}/send`, body, "https://attacker.example"), params)).status).toBe(403);
    expect(runtime.session).not.toHaveBeenCalled();
    runtime.session.mockResolvedValue({ ...actor, session: { id: ids.actor, stepUpUnlocked: false, stepUpUnlockedAt: null } });
    const locked = await send(request(`https://tenant.example/api/catering/inbox/${ids.message}/send`, body), params);
    expect(locked.status).toBe(403); expect(await locked.json()).toMatchObject({ code: "step_up_required" });
    expect(runtime.session).toHaveBeenCalledWith(expect.anything(), `/api/catering/inbox/${ids.message}/send`);
    runtime.session.mockResolvedValue({ ...actor, session: { id: ids.actor, stepUpUnlocked: true, stepUpUnlockedAt: new Date(Date.now() - 600_000).toISOString() } });
    expect(await (await send(request(`https://tenant.example/api/catering/inbox/${ids.message}/send`, body), params)).json()).toMatchObject({ code: "step_up_stale" });
    runtime.session.mockResolvedValue({ ...actor, session: { id: ids.actor, stepUpUnlocked: true, stepUpUnlockedAt: new Date().toISOString() } });
    for (const bad of [null, [], {}, { ...body, to: "x@y.test" }, { ...body, body: "hi" }, { expectedRevision: "1", requestId: ids.request }]) {
      expect((await send(request(`https://tenant.example/api/catering/inbox/${ids.message}/send`, bad), params)).status).toBe(400);
    }
    const refused = await send(request(`https://tenant.example/api/catering/inbox/${ids.message}/send`, body), params);
    expect(refused.status).toBe(409); expect(await refused.json()).toMatchObject({ code: "thread_cap" });
    expect(runtime.sendEmail).not.toHaveBeenCalled();
  });
  it("settings: owner / CGS only, Tier B, closed modes, audited mode change with the previous mode", async () => {
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => name === "set_catering_inbox_mode" ? { data: { mode: args.p_mode, revision: 3, live_since: "2026-11-11T12:00:00Z", changed: true }, error: null } : { data: null, error: { message: "unexpected" } });
    runtime.client.mockReturnValue(fakeInboxService({ tables: liveTables({ catering_inbox_settings: [{ singleton: true, mode: "shadow", revision: 2, live_since: null }] }), rpc }).sb);
    runtime.session.mockResolvedValue(actor);
    expect((await settings(request("https://tenant.example/api/admin/catering-inbox/settings", { mode: "live", expectedRevision: 2 }))).status).toBe(403);
    runtime.session.mockResolvedValue({ ...owner, session: { id: ids.actor, stepUpUnlocked: true, stepUpUnlockedAt: null } });
    expect(await (await settings(request("https://tenant.example/api/admin/catering-inbox/settings", { mode: "live", expectedRevision: 2 }))).json()).toMatchObject({ code: "step_up_stale" });
    runtime.session.mockResolvedValue(owner);
    expect((await settings(request("https://tenant.example/api/admin/catering-inbox/settings", { mode: "on", expectedRevision: 2 }))).status).toBe(400);
    expect((await settings(request("https://tenant.example/api/admin/catering-inbox/settings", { mode: "live", expectedRevision: 2 }, "https://attacker.example"))).status).toBe(403);
    const ok = await settings(request("https://tenant.example/api/admin/catering-inbox/settings", { mode: "live", expectedRevision: 2 }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ settings: { mode: "live", revision: 3, live_since: "2026-11-11T12:00:00Z", changed: true } });
    expect(rpc).toHaveBeenCalledWith("set_catering_inbox_mode", { p_actor_id: ids.actor, p_session_id: ids.actor, p_mode: "live", p_expected_revision: 2 });
    expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.inbox.delivery_mode_change", metadata: expect.objectContaining({ from: "shadow", to: "live", revision: 3 }) }));
    expect(runtime.sendEmail).not.toHaveBeenCalled();
    await expect(setCateringInboxMode(actor, { mode: "off", expectedRevision: 3 })).rejects.toMatchObject({ status: 403 });
  });
  it("send library: a failed provider answer is recorded failed and reported; an unknown message is 404", async () => {
    const finishes: Record<string, unknown>[] = [];
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === "claim_catering_inbox_delivery") return { data: claimReply(), error: null };
      finishes.push(args); return { data: { revision: 3 }, error: null };
    });
    const { sb } = fakeInboxService({ tables: liveTables(), rpc });
    runtime.client.mockReturnValue(sb);
    runtime.sendEmail.mockResolvedValue({ error: "refused", code: "validation_error" });
    expect(await sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).toMatchObject({ state: "failed" });
    expect(finishes[0]).toMatchObject({ p_outcome: "failed", p_error_code: "provider_rejected" });
    expect(runtime.audit.mock.calls.map(([input]) => input.action)).toEqual(["catering.inbox.send", "catering.inbox.delivery_failed"]);
    await expect(sendCateringInboxDraft(actor, "00000000-0000-4000-8000-000000000000", { expectedRevision: 1, requestId: ids.request })).rejects.toMatchObject({ status: 404 });
    await expect(sendCateringInboxDraft({ ...actor, user: { ...actor.user, role: "agm" } } as AuthContext, ids.message, { expectedRevision: 1, requestId: ids.request })).rejects.toMatchObject({ status: 403 });
  });
});
