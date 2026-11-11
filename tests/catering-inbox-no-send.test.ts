import { join, normalize } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { chain, diskReader, importClosure, listFiles, sinkViolations, stripComments, type Reader } from "./fixtures/schedule/no-notify-closure";

const entries = [
  "lib/catering/inbox-ingest.ts", "lib/catering/inbox-identity.ts", "lib/catering/inbox.ts",
  ...listFiles("app/api/catering/inbox"),
].map(normalize);
const overlay = (files: Record<string, string>): Reader => (path) => files[path] ?? diskReader(path);
const inject = (target: string, line: string) => ({ [target]: `${line}\n${diskReader(target) ?? ""}` });
const writers = [
  "lib/catering/quotes.ts", "lib/catering/pipeline.ts", "lib/catering/payments.ts", "lib/catering/prep-demand.ts",
  "lib/catering/system-intake.ts", "lib/portal/draft.ts", "lib/portal/magic-link.ts",
].map(normalize);
const writerCalls = /\b(?:createDraftFromIntake|sendQuote|moveStage|systemMoveStage|reservePrepDemand|consumePrepDemand|releasePrepDemand|recordPayment)\s*\(/;
const directWrites = /\.from\(\s*["']catering_(?:pipeline|quotes|payments|prep_demand)["']\s*\)\s*\.(?:insert|update|upsert|delete)\s*\(/;
function confirmViolations(read: Reader = diskReader) {
  const closure = importClosure(entries, read);
  return [...closure.files].flatMap((file) => writers.includes(file) || writerCalls.test(stripComments(read(file) ?? "")) || directWrites.test(stripComments(read(file) ?? "")) ? [chain(closure, file)] : []);
}

describe("Catering inbox phase 1: transitive no-send and no-confirm boundaries", () => {
  it("walks all three library entries and all four API routes, not a vacuous subset", () => {
    expect(entries.filter((p) => p.endsWith("route.ts"))).toHaveLength(4);
    for (const entry of entries) expect(diskReader(entry), entry).not.toBeNull();
    const closure = importClosure(entries);
    expect(closure.files.size).toBeGreaterThan(entries.length);
    expect(closure.files.has(normalize("lib/supabase-server.ts"))).toBe(true);
  });

  it("reaches no email, notification, digest, SMS or sender package", () => {
    const closure = importClosure(entries);
    expect(sinkViolations(closure, entries)).toEqual([]);
    expect([...closure.files].filter((file) => /digest/i.test(file))).toEqual([]);
  });

  it("imports and calls no stage, quote, payment, portal-intake or prep-demand writer", () => {
    expect(confirmViolations()).toEqual([]);
  });

  it("turns red when a sender is injected directly into every entry", () => {
    for (const target of entries) {
      for (const line of ['import { sendEmail } from "@/lib/email";', 'const sender = import ("resend");', 'export * from "@/lib/notifications";']) {
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
  });
});

const runtime = vi.hoisted(() => ({ sendEmail: vi.fn(), audit: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: runtime.sendEmail }));
vi.mock("@/lib/audit", () => ({ audit: runtime.audit }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: runtime.client }));
import { finalizeCateringInbound } from "@/lib/catering/inbox-ingest";
import { handleCateringInbox, reassignCateringInbox } from "@/lib/catering/inbox";

describe("Catering inbox runtime: proposed replies and human actions never send", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it.each([undefined, "1"])("ingest, handle and reassign issue zero outbound writes with delivery flag %s", async (flag) => {
    vi.stubEnv("CATERING_INBOX_DELIVERY_ENABLED", flag);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://inbox.example.test");
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? "GET") !== "GET" || !url.startsWith("https://api.resend.com/emails/receiving/")) throw new Error("Forbidden outbound request");
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchSpy);
    const id = "11111111-1111-4111-8111-111111111111";
    const rpc = vi.fn(async (name: string) => {
      if (!["finalize_catering_inbound", "act_on_catering_inbox"].includes(name)) throw new Error(`Unexpected writer: ${name}`);
      return { data: { message_id: id, revision: 2, replayed: false }, error: null };
    });
    const from = vi.fn((table: string) => {
      const row = table === "users" ? { role: "catering_mgr", active: true } : ["catering_inbound_messages", "inbound_messages"].includes(table) ? { location_id: null } : null;
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "ilike", "in", "order", "range", "limit", "is", "returns"]) builder[method] = () => builder;
      builder.maybeSingle = async () => ({ data: row, error: null });
      builder.single = async () => ({ data: row, error: null });
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      // No insert/update/delete implementation: unexpected direct writes fail loudly.
      return builder;
    });
    const sb = { from, rpc } as unknown as ReturnType<typeof import("@/lib/supabase-server").getServiceRoleClient>;
    runtime.client.mockReturnValue(sb);
    await finalizeCateringInbound({ id, inbound_message_id: id, revision: 1, disposition: "recorded", sender_address: "guest@example.test",
      subject: "Need catering for Friday", body_text: "We need catering for our event", headers: {}, external_ref: null, thread_key: null }, sb);
    expect(rpc).toHaveBeenCalledWith("finalize_catering_inbound", expect.objectContaining({ p_draft: expect.objectContaining({ template_version: "1" }) }));
    const actor = { user: { id, role: "catering_mgr", active: true }, session: { id } } as AuthContext;
    await handleCateringInbox(actor, id, { expectedRevision: 2, requestId: "22222222-2222-4222-8222-222222222222" });
    await reassignCateringInbox(actor, id, { expectedRevision: 3, requestId: "33333333-3333-4333-8333-333333333333", assignedTo: id });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["finalize_catering_inbound", "act_on_catering_inbox", "act_on_catering_inbox"]);
    expect(runtime.audit.mock.calls.map(([input]) => input.action)).toEqual(["catering.inbox.ingest", "catering.inbox.draft", "catering.inbox.handle", "catering.inbox.reassign"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runtime.sendEmail).not.toHaveBeenCalled();
  });
});
