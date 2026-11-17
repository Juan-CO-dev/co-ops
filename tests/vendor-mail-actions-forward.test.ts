import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { AuthContext } from "@/lib/session";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ send: vi.fn(), rpc: vi.fn(), read: vi.fn(), detail: vi.fn(), download: vi.fn(), audit: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.send }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/vendor-mail", async original => ({ ...await original<typeof import("@/lib/vendor-mail")>(), readVendorMailRow: mocks.read, getVendorMailMessage: mocks.detail }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc, from: mocks.from, storage: { from: () => ({ download: mocks.download }) } }) }));
import { actOnVendorMail } from "@/lib/vendor-mail-actions";
import { forwardVendorMail } from "@/lib/vendor-mail-forward";
const id = "11111111-1111-4111-8111-111111111111";
const request = { expected_revision: 0, request_id: "22222222-2222-4222-8222-222222222222" };
const ctx = { user: { id, role: "owner", active: true }, session: { id } } as AuthContext;
const row = { id, revision: 1, subject: "Invoice", reference_code: "VM-1", from_address: "vendor@example.test", archive_state: "complete", receipt: { raw_storage_path: "body", attachment_paths: [{ path: "invoice", filename: "invoice.pdf", contentType: "application/pdf" }] } };
let event: unknown = null;
let existingClaim: unknown = null;
let replay = false;
let eventQueue: unknown[] = [];
beforeEach(() => {
  vi.clearAllMocks(); event = null; existingClaim = null; replay = false; eventQueue = [];
  vi.stubEnv("INBOUND_RECEIVING_DOMAIN", "receiving.test"); vi.stubEnv("VENDOR_MAIL_FORWARD_ENABLED", "1"); vi.stubEnv("EMAIL_FROM_TEAM", "Compliments Only <team@outbound.test>");
  mocks.read.mockResolvedValue(row); mocks.detail.mockResolvedValue({ body_state: "available", body_text: "Original", body_truncated: false });
  mocks.download.mockResolvedValue({ data: new Blob(["original bytes"]), error: null });
  mocks.send.mockResolvedValue({ id: "provider-1" });
  mocks.rpc.mockImplementation(async (name: string, args: { p_payload: unknown }) => ({ data: { revision: 1, replayed: name.endsWith("claim") && replay, data: args.p_payload }, error: null }));
  mocks.from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    let eventType="";
    for (const method of ["select","eq","order","range"]) q[method] = () => q;
    q.eq = (key:string,value:string) => { if(key === "event_type") eventType=value; return q; };
    q.maybeSingle = () => Promise.resolve({ data: eventType === "forward_claim" ? existingClaim : eventQueue.length ? eventQueue.shift() : event, error: null });
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "locations" ? [{ receipt_email_address: "shop@receiving.test" }] : [{ address: "catering@company.test" }], error: null }).then(resolve);
    return q;
  });
});
afterEach(() => vi.unstubAllEnvs());
it.each(["handle","assign","redrive"] as const)("%s has zero sends", async action => {
  await actOnVendorMail(ctx, id, action, request, action === "handle" ? { reason: "Done" } : {});
  expect(mocks.send).not.toHaveBeenCalled();
});
it("off switch refuses before I/O or sending", async () => {
  vi.stubEnv("VENDOR_MAIL_FORWARD_ENABLED", "0");
  await expect(forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"})).rejects.toMatchObject({ code: "forward_off" });
  expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});
it("claim precedes send, preserves original bytes, hashes body, and hides paths", async () => {
  const result = await forwardVendorMail(ctx,id,{...request,recipient:"person@external.test",note:"FYI"});
  expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]!);
  expect(mocks.send.mock.calls[0]![0].attachments[0].content.equals(Buffer.from("original bytes"))).toBe(true);
  expect(mocks.rpc.mock.calls[0]![1].p_payload.body_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(mocks.send.mock.calls[0]![0].idempotencyKey).toBe(`vendor-mail/${request.request_id}`);
  expect(result).toMatchObject({ outcome: "accepted" }); expect(result).not.toHaveProperty("data");
});
it.each(["", "catering@outbound.test"])("requires team sender %s", async sender => {
  vi.stubEnv("EMAIL_FROM_TEAM",sender);
  await expect(forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"})).rejects.toMatchObject({ code:"forward_sender_missing" });
  expect(mocks.send).not.toHaveBeenCalled();
});
it("refuses any address on receiving domain",async () => {
  await expect(forwardVendorMail(ctx,id,{...request,recipient:"unknown@receiving.test"})).rejects.toMatchObject({ code:"forward_loop" });
  expect(mocks.send).not.toHaveBeenCalled();
});
it("refuses encoded messages above 40 MB without omitting attachments",async () => {
  mocks.download.mockResolvedValue({ data: { size: 31_000_000 }, error:null });
  await expect(forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"})).rejects.toMatchObject({ code:"forward_too_large" });
  expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("records thrown sender outcome as ambiguous", async () => {
  mocks.send.mockRejectedValue(new Error("timeout"));
  expect(await forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"})).toMatchObject({ outcome:"unknown" });
  expect(mocks.rpc.mock.calls[1]![1].p_payload).toMatchObject({ outcome:"unknown",error:"unknown" });
});
it("reports provider idempotency mismatch by name", async () => {
  mocks.send.mockResolvedValue({ error:"mismatch",code:"invalid_idempotent_request" });
  await expect(forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"})).rejects.toMatchObject({ code:"forward_payload_mismatch" });
});
it("completed replay does not resend", async () => {
  replay=true; event={ data:{ outcome:"accepted" } };
  expect(await forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"})).toMatchObject({ replayed:true,outcome:"accepted" });
  expect(mocks.send).not.toHaveBeenCalled();
});

it("crash retry within 24h reuses original provider key",async () => {
 replay=true; eventQueue=[null,{created_at:new Date(Date.now()-3600_000).toISOString()}];
 await forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"});
 expect(mocks.send.mock.calls[0]![0].idempotencyKey).toBe(`vendor-mail/${request.request_id}`);
});
it("crash retry after 24h refuses another send",async () => {
 replay=true; eventQueue=[null,{created_at:new Date(Date.now()-25*3600_000).toISOString()}];
 await expect(forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"})).rejects.toMatchObject({code:"forward_unknown"});
 expect(mocks.send).not.toHaveBeenCalled();
});
it("missing original refuses before claim/send",async () => {
 mocks.download.mockResolvedValue({data:null,error:{message:"missing"}});
 await expect(forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"})).rejects.toMatchObject({code:"forward_originals_missing"});
 expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("result storage failure never sends a second time in the same request",async () => {
 mocks.rpc.mockImplementation(async (name:string,args:{p_payload:unknown})=> name.endsWith("result") ? {data:null,error:{message:"database unavailable"}} : {data:{revision:1,replayed:false,data:args.p_payload},error:null});
 await expect(forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"})).rejects.toMatchObject({code:"vendor_mail_unavailable"});
 expect(mocks.send).toHaveBeenCalledTimes(1);
});

it("completed replay survives unavailable originals",async()=>{
 existingClaim={data:{recipient:"person@external.test",note:"",sender:"team@outbound.test",body:"Original",attachments:[]}};
 event={revision:2,data:{outcome:"accepted"}};
 mocks.detail.mockRejectedValue(new Error("original unavailable"));
 expect(await forwardVendorMail(ctx,id,{...request,recipient:"person@external.test"})).toMatchObject({replayed:true,outcome:"accepted"});
 expect(mocks.send).not.toHaveBeenCalled();expect(mocks.detail).not.toHaveBeenCalled();
});

it.each(["application_error", "internal_server_error", "concurrent_idempotent_requests", "invalid_idempotent_request", undefined, "future_code"])("ambiguous provider code %s persists unknown", async code => {
  mocks.send.mockResolvedValue({ error: "provider", code });
  const result = forwardVendorMail(ctx, id, { ...request, recipient: "gm@company.test" });
  if (code === "invalid_idempotent_request") await expect(result).rejects.toMatchObject({ code: "forward_payload_mismatch" });
  else expect(await result).toMatchObject({ outcome: "unknown" });
  expect(mocks.rpc.mock.calls[1]![1].p_payload.outcome).toBe("unknown");
});
it.each(["validation_error", "missing_required_field", "invalid_from_address", "invalid_attachment", "missing_api_key", "invalid_api_key", "restricted_api_key", "monthly_quota_exceeded", "daily_quota_exceeded", "rate_limit_exceeded"])("definite rejection %s persists failed", async code => {
  mocks.send.mockResolvedValue({ error: "provider", code });
  expect(await forwardVendorMail(ctx, id, { ...request, recipient: "gm@company.test" })).toMatchObject({ outcome: "failed" });
});
it.each(["catering@company.test", "shop@receiving.test", "x@sub.receiving.test"])("blocks exact receiving alias or receiving subdomain %s", async recipient => {
  await expect(forwardVendorMail(ctx,id,{...request,recipient})).rejects.toMatchObject({code:"forward_loop"});
  expect(mocks.send).not.toHaveBeenCalled();
});
it("allows other company addresses and sends from the team address the claim froze", async () => {
  await forwardVendorMail(ctx,id,{...request,recipient:"gm@company.test"});
  // VML-r4: the claim can hold only the bare address (0326), so that address is the From of every send of this request.
  expect(mocks.rpc.mock.calls[0]![1].p_payload.sender).toBe("team@outbound.test");
  expect(mocks.send.mock.calls[0]![0].from).toBe("team@outbound.test");
});
it.each(["", "@bad", "receiving.test/path"])("fails closed on missing/invalid receiving domain %s", async domain => {
  vi.stubEnv("INBOUND_RECEIVING_DOMAIN",domain);
  await expect(forwardVendorMail(ctx,id,{...request,recipient:"gm@company.test"})).rejects.toMatchObject({code:"forward_domain_missing"});
  expect(mocks.send).not.toHaveBeenCalled();
});
it("body over 128 KB has its own refusal before claim/send", async () => {
  mocks.detail.mockResolvedValue({body_state:"available",body_text:"a".repeat(131073),body_truncated:false});
  await expect(forwardVendorMail(ctx,id,{...request,recipient:"gm@company.test"})).rejects.toMatchObject({code:"forward_body_too_large"});
  expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});

// Fix round 3 (VML-r3 P2): a claim committed before a body-converter change, with no result yet, still completes.
const frozenBody = "From: vendor@example.test\nSubject: Invoice\n\nInvoice";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const frozenClaim = (over: Record<string, unknown> = {}) => ({ data: { recipient: "person@external.test", sender: "team@outbound.test", note: "", body: frozenBody, body_sha256: sha(frozenBody), attachments: [{ path: "invoice", filename: "invoice.pdf", sha256: sha("original bytes") }], ...over } });
it("unfinished pre-change claim resumes from its frozen body after the converter changes", async () => {
  replay = true; existingClaim = frozenClaim();
  // The converter now renders the same HTML differently (link targets kept): a rebuilt body would not match the claim.
  mocks.detail.mockResolvedValue({ body_state: "available", body_text: "Invoice <https://vendor.example/invoice/42>", body_truncated: false });
  eventQueue = [null, { created_at: new Date(Date.now() - 3600_000).toISOString() }];
  const result = await forwardVendorMail(ctx, id, { ...request, recipient: "person@external.test" });
  expect(mocks.rpc.mock.calls.filter(c => c[0] === "vendor_mail_forward_claim")).toHaveLength(1);
  expect(mocks.rpc.mock.calls[0]![1].p_payload).toEqual(frozenClaim().data);
  expect(mocks.detail).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  const sent = mocks.send.mock.calls[0]![0];
  expect(sent.text).toBe(frozenBody);
  expect(sent.idempotencyKey).toBe(`vendor-mail/${request.request_id}`);
  expect(sent.attachments[0]).toMatchObject({ filename: "invoice.pdf", contentType: "application/pdf" });
  expect(sent.attachments[0].content.equals(Buffer.from("original bytes"))).toBe(true);
  expect(result).toMatchObject({ outcome: "accepted" });
});
it("resumed claim refuses when the frozen body fails its hash", async () => {
  replay = true; existingClaim = frozenClaim({ body: "tampered" });
  eventQueue = [null, { created_at: new Date().toISOString() }];
  await expect(forwardVendorMail(ctx, id, { ...request, recipient: "person@external.test" })).rejects.toMatchObject({ code: "forward_originals_missing" });
  expect(mocks.send).not.toHaveBeenCalled();
});
it("resumed claim refuses when an attachment no longer matches its manifest hash", async () => {
  replay = true; existingClaim = frozenClaim();
  mocks.download.mockResolvedValue({ data: new Blob(["changed bytes"]), error: null });
  eventQueue = [null, { created_at: new Date().toISOString() }];
  await expect(forwardVendorMail(ctx, id, { ...request, recipient: "person@external.test" })).rejects.toMatchObject({ code: "forward_originals_missing" });
  expect(mocks.send).not.toHaveBeenCalled();
});
it("resumed claim keeps the 24h retry window", async () => {
  replay = true; existingClaim = frozenClaim();
  eventQueue = [null, { created_at: new Date(Date.now() - 25 * 3600_000).toISOString() }];
  await expect(forwardVendorMail(ctx, id, { ...request, recipient: "person@external.test" })).rejects.toMatchObject({ code: "forward_unknown" });
  expect(mocks.send).not.toHaveBeenCalled();
});

// Fix round 4 (VML-r4 P2): a resumed claim sends with EVERYTHING frozen in it — never re-read configuration.
it("resumed claim sends from its frozen sender even after EMAIL_FROM_TEAM changes", async () => {
  replay = true; existingClaim = frozenClaim({ sender: "team@old.test" });
  vi.stubEnv("EMAIL_FROM_TEAM", "Compliments Only <team@new.test>");
  eventQueue = [null, { created_at: new Date(Date.now() - 3600_000).toISOString() }];
  await forwardVendorMail(ctx, id, { ...request, recipient: "person@external.test" });
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0]![0].from).toBe("team@old.test");
});
it("resumed claim does not need EMAIL_FROM_TEAM at all", async () => {
  replay = true; existingClaim = frozenClaim({ sender: "team@old.test" });
  vi.stubEnv("EMAIL_FROM_TEAM", "");
  eventQueue = [null, { created_at: new Date(Date.now() - 3600_000).toISOString() }];
  await forwardVendorMail(ctx, id, { ...request, recipient: "person@external.test" });
  expect(mocks.send.mock.calls[0]![0].from).toBe("team@old.test");
});
it("first send and resume send the identical payload", async () => {
  await forwardVendorMail(ctx, id, { ...request, recipient: "person@external.test", note: "FYI" });
  const first = mocks.send.mock.calls[0]![0];
  const claimed = mocks.rpc.mock.calls[0]![1].p_payload;
  vi.clearAllMocks(); mocks.send.mockResolvedValue({ id: "provider-1" });
  mocks.read.mockResolvedValue(row); mocks.download.mockResolvedValue({ data: new Blob(["original bytes"]), error: null });
  replay = true; existingClaim = { data: claimed };
  vi.stubEnv("EMAIL_FROM_TEAM", "Other Name <team@new.test>");
  // The archive's asset list was rewritten since the claim: its content types must not leak into the resend.
  mocks.read.mockResolvedValue({ ...row, receipt: { ...row.receipt, attachment_paths: [{ path: "invoice", filename: "invoice.pdf", contentType: "application/octet-stream" }] } });
  eventQueue = [null, { created_at: new Date(Date.now() - 3600_000).toISOString() }];
  await forwardVendorMail(ctx, id, { ...request, recipient: "person@external.test", note: "FYI" });
  expect(mocks.send.mock.calls[0]![0]).toEqual(first);
});
it("resumed claim refuses when the message's subject no longer matches the frozen body", async () => {
  replay = true; existingClaim = frozenClaim();
  mocks.read.mockResolvedValue({ ...row, subject: "Changed" });
  eventQueue = [null, { created_at: new Date(Date.now() - 3600_000).toISOString() }];
  await expect(forwardVendorMail(ctx, id, { ...request, recipient: "person@external.test" })).rejects.toMatchObject({ code: "request_conflict" });
  expect(mocks.send).not.toHaveBeenCalled();
});
it("resumed claim sends to its frozen recipient", async () => {
  replay = true; existingClaim = frozenClaim();
  eventQueue = [null, { created_at: new Date(Date.now() - 3600_000).toISOString() }];
  await forwardVendorMail(ctx, id, { ...request, recipient: " Person@External.test " });
  expect(mocks.send.mock.calls[0]![0].to).toBe("person@external.test");
});
