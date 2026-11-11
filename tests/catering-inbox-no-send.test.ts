import { join, normalize } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { chain, diskReader, importClosure, listFiles, sinkViolations, stripComments, type Reader } from "./fixtures/schedule/no-notify-closure";
import { claimReply, fakeInboxService, ids, liveEnv, type Row } from "./fixtures/catering-inbox/fake-service";

// Phase 1b: EVERY inbox module except the delivery boundary stays sender-free. The boundary is reached only by the
// Send route and the delivery cron, and every sink those two reach passes through lib/catering/inbox-delivery.ts.
const BOUNDARY = normalize("lib/catering/inbox-delivery.ts");
const entries = [
  "lib/catering/inbox-ingest.ts", "lib/catering/inbox-identity.ts", "lib/catering/inbox.ts", "lib/catering/inbox-settings.ts",
  ...listFiles("app/api/catering/inbox").filter((file) => !/[\\/]send[\\/]route\.tsx?$/.test(file)),
  "app/api/admin/catering-inbox/settings/route.ts",
].map(normalize);
const senders = ["app/api/catering/inbox/[id]/send/route.ts", "app/api/cron/catering-inbox-delivery/route.ts"].map(normalize);
const overlay = (files: Record<string, string>): Reader => (path) => files[path] ?? diskReader(path);
const inject = (target: string, line: string) => ({ [target]: `${line}\n${diskReader(target) ?? ""}` });
const writers = [
  "lib/catering/quotes.ts", "lib/catering/pipeline.ts", "lib/catering/payments.ts", "lib/catering/prep-demand.ts",
  "lib/catering/system-intake.ts", "lib/portal/draft.ts", "lib/portal/magic-link.ts",
].map(normalize);
const writerCalls = /\b(?:createDraftFromIntake|sendQuote|moveStage|systemMoveStage|reservePrepDemand|consumePrepDemand|releasePrepDemand|recordPayment)\s*\(/;
const directWrites = /\.from\(\s*["']catering_(?:pipeline|quotes|payments|prep_demand)["']\s*\)\s*\.(?:insert|update|upsert|delete)\s*\(/;
// The router also imports the vendor ingest closure. Check only its catering
// branch with a positive call allowlist; the whole router cannot be a no-send entry.
function cateringCalls(source: string): string[] {
  const start = source.indexOf('if (route.lane === "catering")');
  const end = source.indexOf('if (route.lane !== "vendor_receipt")', start);
  if (start < 0 || end <= start) return ["missing catering boundary"];
  const file = ts.createSourceFile("branch.ts", source.slice(start, end), ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const pure = new Set(["readChild", "inboxHeaders", "inboxAttachmentManifest", "inboxContent", "inboxExternalReference", "randomUUID", "save", "finalizeCateringInbound"]);
  function walk(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const target = node.expression.getText(file);
      if (target === "fetchInboundContent") {
        if (node.arguments.length !== 3 || node.arguments[0]?.getText(file) !== "row.provider_email_id" || node.arguments[1]?.getText(file) !== "undefined" || node.arguments[2]?.getText(file).replace(/\s/g, "") !== "{metadataOnly:true}") violations.push(target);
      } else if (target === "sb.rpc") {
        if (node.arguments[0]?.getText(file) !== '"record_catering_inbound"') violations.push(target);
      } else if (target === "sb.from") {
        if (node.arguments[0]?.getText(file) !== '"catering_inbound_messages"') violations.push(target);
      } else if (!pure.has(target)) {
        const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
        // Pure transformations plus the single child lookup's read-only builder.
        if (!["map", "slice", "split", "find", "select", "eq", "maybeSingle"].includes(method)) violations.push(target);
      }
    }
    if (ts.isNewExpression(node) && !["Set", "Error"].includes(node.expression.getText(file))) violations.push(node.expression.getText(file));
    ts.forEachChild(node, walk);
  }
  walk(file);
  return violations;
}
function confirmViolations(read: Reader = diskReader, roots = [...entries, ...senders]) {
  const closure = importClosure(roots, read);
  return [...closure.files].flatMap((file) => writers.includes(file) || writerCalls.test(stripComments(read(file) ?? "")) || directWrites.test(stripComments(read(file) ?? "")) ? [chain(closure, file)] : []);
}

describe("Catering inbox: transitive no-send and no-confirm boundaries (phase 1b)", () => {
  it("allowlists the live router catering branch and detects injected writes and full-content fetches", () => {
    const source = diskReader(normalize("lib/inbound-router.ts"))!;
    expect(cateringCalls(source)).toEqual([]);
    for (const injected of ['await sendEmail();', 'await fetch("https://example.test", { method: "POST" });', 'await sb.rpc("send_catering", {});', 'await sb.from("catering_inbound_messages").update({});', 'await fetchInboundContent(row.provider_email_id);']) {
      expect(cateringCalls(source.replace('if (route.lane === "catering") {', `if (route.lane === "catering") { ${injected}`)).length).toBeGreaterThan(0);
    }
  });
  it("walks the four library entries and five sender-free routes, not a vacuous subset", () => {
    expect(entries.filter((p) => p.endsWith("route.ts"))).toHaveLength(5);
    for (const entry of [...entries, ...senders, BOUNDARY]) expect(diskReader(entry), entry).not.toBeNull();
    const closure = importClosure(entries);
    expect(closure.files.size).toBeGreaterThan(entries.length);
    expect(closure.files.has(normalize("lib/supabase-server.ts"))).toBe(true);
    expect(closure.files.has(BOUNDARY)).toBe(false);
  });
  it("every module except the delivery boundary reaches no email, notification, digest, SMS or sender package", () => {
    const closure = importClosure(entries);
    expect(sinkViolations(closure, entries)).toEqual([]);
    expect([...closure.files].filter((file) => /digest/i.test(file))).toEqual([]);
  });
  it("the send route and the delivery cron reach exactly one sender, and only through the boundary", () => {
    const closure = importClosure(senders);
    expect(closure.files.has(BOUNDARY)).toBe(true);
    const violations = sinkViolations(closure, senders);
    expect(violations.length).toBeGreaterThan(0);
    for (const violation of violations) expect(violation, violation).toContain("inbox-delivery.ts");
    // The boundary imports ONE sink, lib/email.ts; everything else email-shaped is reached only through it.
    const sinks = [...closure.files].filter((file) => violations.some((v) => v.startsWith(`sink module reached: `) && v.endsWith(file)));
    expect(sinks).toContain(normalize("lib/email.ts"));
    for (const sink of sinks) if (sink !== normalize("lib/email.ts")) expect(chain(closure, sink), sink).toContain(`${BOUNDARY} → ${normalize("lib/email.ts")}`);
    expect(closure.packages.get("resend")).toBe(normalize("lib/email.ts"));
    expect([...closure.files].filter((file) => /digest|notifications|sms/i.test(file))).toEqual([]);
  });
  it("imports and calls no stage, quote, payment, portal-intake or prep-demand writer (boundary included)", () => {
    expect(confirmViolations()).toEqual([]);
  });
  it("turns red when a sender is injected directly into every sender-free entry", () => {
    for (const target of entries) {
      for (const line of ['import { sendEmail } from "@/lib/email";', 'const sender = import ("resend");', 'export * from "@/lib/notifications";', 'import { sendCateringInboxDraft } from "@/lib/catering/inbox-delivery";']) {
        expect(sinkViolations(importClosure(entries, overlay(inject(target, line))), entries).length, `${target}: ${line}`).toBeGreaterThan(0);
      }
    }
  });
  it("turns red when an innocent helper transitively imports a sender", () => {
    const helper = join("lib", "inbox-fake-helper.ts");
    for (const target of entries) {
      const read = overlay({
        ...inject(target, 'import { helper } from "@/lib/inbox-fake-helper";'),
        [helper]: 'import { sendEmail } from "@/lib/email"; export const helper = () => sendEmail();',
      });
      expect(sinkViolations(importClosure(entries, read), entries).some((message) => message.includes("inbox-fake-helper") && message.includes("email.ts")), target).toBe(true);
    }
  });
  it("turns red when a second sender path bypasses the boundary from the send route", () => {
    const helper = join("lib", "inbox-fake-sender.ts");
    const read = overlay({ ...inject(senders[0]!, 'import "@/lib/inbox-fake-sender";'), [helper]: 'import { sendEmail } from "@/lib/email"; export const go = () => sendEmail();' });
    const closure = importClosure(senders, read);
    expect(sinkViolations(closure, senders).some((v) => v.includes("inbox-fake-sender") && !v.includes("inbox-delivery.ts"))).toBe(true);
  });
  it("turns red for direct and transitive artifact writers and direct writer calls", () => {
    const target = entries[0]!;
    const helper = join("lib", "inbox-fake-helper.ts");
    for (const writer of writers) {
      const spec = `@/${writer.replaceAll("\\", "/").replace(/\.ts$/, "")}`;
      expect(confirmViolations(overlay(inject(target, `import * as writer from "${spec}";`))).length).toBeGreaterThan(0);
      expect(confirmViolations(overlay({ ...inject(target, 'import "@/lib/inbox-fake-helper";'), [helper]: `export * from "${spec}";` })).length).toBeGreaterThan(0);
    }
    expect(confirmViolations(overlay(inject(target, "void systemMoveStage();"))).length).toBeGreaterThan(0);
    expect(confirmViolations(overlay(inject(target, 'sb.from("catering_pipeline").update({ stage: "confirmed" });'))).length).toBeGreaterThan(0);
    expect(confirmViolations(overlay(inject(BOUNDARY, "void sendQuote();"))).length).toBeGreaterThan(0);
  });
});

const runtime = vi.hoisted(() => ({ sendEmail: vi.fn(), audit: vi.fn(), client: vi.fn(), lease: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: runtime.sendEmail }));
vi.mock("@/lib/audit", () => ({ audit: runtime.audit }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: runtime.client }));
vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: runtime.lease }));
import { finalizeCateringInbound } from "@/lib/catering/inbox-ingest";
import { handleCateringInbox, reassignCateringInbox } from "@/lib/catering/inbox";
import { runCateringInboxDelivery, sendCateringInboxDraft } from "@/lib/catering/inbox-delivery";
import { GET as cron } from "@/app/api/cron/catering-inbox-delivery/route";
import { NextRequest } from "next/server";

const actor = { user: { id: ids.actor, role: "catering_mgr", active: true }, session: { id: ids.actor } } as AuthContext;
function tables(mode: "off" | "shadow" | "live", extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    users: [{ id: ids.actor, role: "catering_mgr", active: true, language: "en" }, { id: ids.assignee, role: "catering_mgr", active: true, language: "es" }],
    user_locations: [], inbound_address_aliases: [], locations: [], inbound_messages: [{ id: ids.message, location_id: null }],
    catering_inbox_settings: [{ singleton: true, mode, revision: 1, live_since: mode === "live" ? "2026-11-11T00:00:00Z" : null }],
    catering_inbound_messages: [{ id: ids.message, location_id: null, sender_address: "guest@example.test", headers: { "message-id": "<inbound-1@example.test>" }, disposition: "drafted", recorded_at: "2026-11-11T01:00:00Z" }],
    catering_inbox_drafts: [{ id: ids.draft, message_id: ids.message, kind: "reply", delivery_state: "draft", delivery_attempt: 0, delivery_attempted_at: null, created_at: "2026-11-11T01:00:00Z", preview_text: "x" }],
    ...extra,
  };
}
const forbidOutbound = () => vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if ((init?.method ?? "GET") !== "GET" || !url.startsWith("https://api.resend.com/emails/receiving/")) throw new Error("Forbidden outbound request");
  return Response.json({});
}));

describe("Catering inbox runtime: off and shadow never send, live sends once per claim", () => {
  beforeEach(() => { vi.stubEnv("CRON_SECRET", "cron-secret"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it.each([
    ["off", undefined], ["off", "1"], ["shadow", undefined], ["shadow", "1"],
  ] as const)("mode %s with delivery flag %s: ingest, handle, reassign, send and the cron issue zero sends", async (mode, flag) => {
    for (const [key, value] of Object.entries(liveEnv)) vi.stubEnv(key, value);
    vi.stubEnv("CATERING_INBOX_DELIVERY_ENABLED", flag ?? "");
    if (flag === undefined) delete process.env.CATERING_INBOX_DELIVERY_ENABLED;
    forbidOutbound();
    const rpc = vi.fn((name: string) => {
      if (!["finalize_catering_inbound", "act_on_catering_inbox"].includes(name)) throw new Error(`Unexpected writer: ${name}`);
      return { data: { message_id: ids.message, revision: 2, replayed: false }, error: null };
    });
    const { sb } = fakeInboxService({ tables: tables(mode), rpc });
    runtime.client.mockReturnValue(sb);
    await finalizeCateringInbound({ id: ids.message, inbound_message_id: ids.message, revision: 1, disposition: "recorded", sender_address: "guest@example.test",
      subject: "Need catering for Friday", body_text: "We need catering for our event", headers: {}, external_ref: null, thread_key: null }, sb);
    expect(rpc).toHaveBeenCalledWith("finalize_catering_inbound", expect.objectContaining({ p_draft: expect.objectContaining({ template_version: "1", params: expect.objectContaining({ portalUrl: "https://staff.example.test/order/start" }) }) }));
    await handleCateringInbox(actor, ids.message, { expectedRevision: 2, requestId: ids.request });
    await reassignCateringInbox(actor, ids.message, { expectedRevision: 3, requestId: "33333333-3333-4333-8333-333333333334", assignedTo: ids.actor });
    await expect(sendCateringInboxDraft(actor, ids.message, { expectedRevision: 3, requestId: ids.request })).rejects.toMatchObject({ status: 409, code: "delivery_off" });
    expect(await runCateringInboxDelivery({ service: sb })).toMatchObject({ ran: false, reason: "delivery_off" });
    const response = await cron(new NextRequest("https://tenant.example/api/cron/catering-inbox-delivery", { headers: { authorization: "Bearer cron-secret" } }));
    expect(await response.json()).toEqual({ skipped: true, reason: "delivery_off" });
    expect(runtime.lease).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["finalize_catering_inbound", "act_on_catering_inbox", "act_on_catering_inbox"]);
    expect(runtime.audit.mock.calls.map(([input]) => input.action)).toEqual(["catering.inbox.ingest", "catering.inbox.draft", "catering.inbox.handle", "catering.inbox.reassign"]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(runtime.sendEmail).not.toHaveBeenCalled();
  });
  it("live mode without the env flag, or with the flag but no explicit senders, sends nothing", async () => {
    for (const [key, value] of Object.entries(liveEnv)) vi.stubEnv(key, value);
    const { sb } = fakeInboxService({ tables: tables("live"), rpc: () => { throw new Error("no claim expected"); } });
    runtime.client.mockReturnValue(sb);
    vi.stubEnv("CATERING_INBOX_DELIVERY_ENABLED", "");
    await expect(sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).rejects.toMatchObject({ code: "delivery_off" });
    vi.stubEnv("CATERING_INBOX_DELIVERY_ENABLED", "1");
    vi.stubEnv("CATERING_INBOX_FROM", "");
    await expect(sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).rejects.toMatchObject({ status: 503, code: "not_configured" });
    expect(await runCateringInboxDelivery({ service: sb })).toMatchObject({ ran: false, reason: "not_configured" });
    vi.stubEnv("CATERING_INBOX_FROM", "catering@example.test"); vi.stubEnv("EMAIL_FROM_TEAM", "not an address");
    await expect(sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).rejects.toMatchObject({ code: "not_configured" });
    expect(runtime.sendEmail).not.toHaveBeenCalled();
  });
  it("live mode sends exactly once per claim, from the inbox sender, threaded, under the claim's idempotency key", async () => {
    for (const [key, value] of Object.entries(liveEnv)) vi.stubEnv(key, value);
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === "claim_catering_inbox_delivery") return { data: claimReply(), error: null };
      if (name === "finish_catering_inbox_delivery") return { data: { revision: 3, draft_id: args.p_draft_id, attempt: 1, state: args.p_outcome }, error: null };
      throw new Error(`Unexpected writer: ${name}`);
    });
    const { sb } = fakeInboxService({ tables: tables("live"), rpc });
    runtime.client.mockReturnValue(sb);
    runtime.sendEmail.mockResolvedValue({ id: "provider-1" });
    const result = await sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request });
    expect(result).toMatchObject({ state: "sent", draft_id: ids.draft, attempt: 1, revision: 3 });
    expect(runtime.sendEmail).toHaveBeenCalledTimes(1);
    expect(runtime.sendEmail.mock.calls[0]![0]).toMatchObject({ to: "guest@example.test", from: "Catering <catering@example.test>", idempotencyKey: `catering-inbox:${ids.draft}:1`,
      inReplyTo: "<inbound-1@example.test>", references: ["<root@example.test>", "<inbound-1@example.test>"], subject: "Your catering inquiry" });
    expect(runtime.sendEmail.mock.calls[0]![0].text).toContain("https://portal.example.test/order/start");
    expect(runtime.sendEmail.mock.calls[0]![0].html).not.toContain("<script");
    expect(rpc).toHaveBeenCalledWith("claim_catering_inbox_delivery", expect.objectContaining({ p_kind: "reply", p_trigger: "human", p_actor_id: ids.actor, p_session_id: ids.actor, p_expected_revision: 1, p_request_id: ids.request }));
    expect(rpc).toHaveBeenCalledWith("finish_catering_inbox_delivery", { p_draft_id: ids.draft, p_token: "token-1", p_outcome: "sent", p_provider_id: "provider-1", p_error_code: null });
    expect(runtime.audit.mock.calls.map(([input]) => input.action)).toEqual(["catering.inbox.send", "catering.inbox.delivery_sent"]);
    expect(JSON.stringify(runtime.audit.mock.calls)).not.toContain("guest@example.test");
  });
  it("an uncertain provider answer is retried once under the SAME key, then recorded ambiguous — never a new key", async () => {
    for (const [key, value] of Object.entries(liveEnv)) vi.stubEnv(key, value);
    const finishes: Record<string, unknown>[] = [];
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === "claim_catering_inbox_delivery") return { data: claimReply(), error: null };
      finishes.push(args); return { data: { revision: 3 }, error: null };
    });
    const { sb } = fakeInboxService({ tables: tables("live"), rpc });
    runtime.client.mockReturnValue(sb);
    runtime.sendEmail.mockResolvedValueOnce({ error: "socket hang up" }).mockResolvedValueOnce({ id: "provider-2" });
    expect(await sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).toMatchObject({ state: "sent" });
    expect(runtime.sendEmail).toHaveBeenCalledTimes(2);
    expect(runtime.sendEmail.mock.calls[1]![0].idempotencyKey).toBe(runtime.sendEmail.mock.calls[0]![0].idempotencyKey);
    runtime.sendEmail.mockReset().mockResolvedValue({ error: "timeout" });
    expect(await sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).toMatchObject({ state: "ambiguous" });
    expect(runtime.sendEmail).toHaveBeenCalledTimes(2);
    expect(finishes.at(-1)).toMatchObject({ p_outcome: "ambiguous", p_error_code: "provider_uncertain", p_provider_id: null });
    expect(runtime.audit.mock.calls.map(([input]) => input.action)).toContain("catering.inbox.delivery_ambiguous");
  });
  it("a replayed claim and a loop-guarded message send nothing", async () => {
    for (const [key, value] of Object.entries(liveEnv)) vi.stubEnv(key, value);
    const rpc = vi.fn((name: string) => name === "claim_catering_inbox_delivery" ? { data: { message_id: ids.message, revision: 2, replayed: true }, error: null } : { data: null, error: { message: "unexpected" } });
    const { sb } = fakeInboxService({ tables: tables("live"), rpc });
    runtime.client.mockReturnValue(sb);
    expect(await sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).toMatchObject({ state: "replayed" });
    rpc.mockReturnValueOnce({ data: { refused: "needs_review", replayed: false } as never, error: null });
    const guarded = fakeInboxService({ tables: tables("live", { catering_inbound_messages: [{ id: ids.message, location_id: null, sender_address: "guest@example.test", headers: { "auto-submitted": "auto-replied" }, disposition: "drafted" }] }), rpc });
    runtime.client.mockReturnValue(guarded.sb);
    await expect(sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).rejects.toMatchObject({ code: "needs_review" });
    const own = fakeInboxService({ tables: tables("live", { catering_inbound_messages: [{ id: ids.message, location_id: null, sender_address: "catering@example.test", headers: {}, disposition: "drafted" }] }), rpc });
    runtime.client.mockReturnValue(own.sb);
    await expect(sendCateringInboxDraft(actor, ids.message, { expectedRevision: 1, requestId: ids.request })).rejects.toMatchObject({ code: "invalid_recipient" });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(runtime.sendEmail).not.toHaveBeenCalled();
  });
});
