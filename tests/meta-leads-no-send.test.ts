/**
 * Build 2, item 8 — THE NO-SEND PROOF.
 *  1. Runtime: with META_LEADS_ENABLED off, the worker, the sweep, the webhook and the cron call no
 *     sender (sendEmail never runs, the portal mint never runs, no database client is even built).
 *  2. Static: in the TRANSITIVE import closure of the Meta entries, the ONLY importers of the email
 *     module are the portal's own two senders (lib/portal/magic-link.ts — the continuation path —
 *     and lib/portal/draft.ts — the order confirmation, unreachable from the worker); nothing under
 *     lib/meta-leads or the two routes names sendEmail, and the only Meta module that reaches the
 *     portal mint is lib/meta-leads/continuation.ts.
 */
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importClosure, importSpecifiers, listFiles, stripComments } from "./fixtures/schedule/no-notify-closure";

const mocks = vi.hoisted(() => ({ send: vi.fn(), mint: vi.fn(), db: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.send }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.db }));
vi.mock("@/lib/portal/magic-link", () => ({ resolveOrCreatePortalCustomer: vi.fn(), mintAndSendPortalLink: mocks.mint, META_CONTINUATION_TTL_MIN: 4320 }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
import { processMetaLead, sweepMetaLeads } from "@/lib/meta-leads/worker";
import { sendMetaContinuation } from "@/lib/meta-leads/continuation";
import { GET as cronGet } from "@/app/api/cron/meta-leads/route";

describe("runtime: the switch off sends nothing", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("META_LEADS_ENABLED", ""); vi.stubEnv("CRON_SECRET", "cron-secret"); vi.stubEnv("RESEND_API_KEY", "re_stub"); vi.stubEnv("EMAIL_FROM", "catering@example.test"); });
  afterEach(() => vi.unstubAllEnvs());
  it("worker, sweep and cron: zero sendEmail, zero mint, zero client", async () => {
    expect(await processMetaLead("11")).toBe("disabled");
    expect(await sweepMetaLeads()).toEqual({ processed: 0 });
    const res = await cronGet(new Request("https://staff.test/api/cron/meta-leads", { headers: { authorization: "Bearer cron-secret" } }) as never);
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ disabled: true });
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.mint).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("the continuation itself never reaches the sender when the ledger refuses the claim", async () => {
    const sb = { rpc: vi.fn(async () => ({ data: { claimed: false, reason: "not_claimable" } })) } as unknown as Parameters<typeof sendMetaContinuation>[0];
    expect(await sendMetaContinuation(sb, { leadgenId: "11", pipelineId: "p", locationId: "l", language: "en", intake: { contactName: "A", contactEmail: "a@example.test", marketingEmail: "a@example.test", secondaryEmail: null, contactPhone: null, company: null, headcount: null, eventDate: null, shopCode: "x", isDelivery: false, notes: null } })).toBe("not_claimable");
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.mint).not.toHaveBeenCalled();
  });
});

const ENTRIES = [join("lib", "meta-leads", "worker.ts"), join("app", "api", "webhooks", "meta-leads", "route.ts"), join("app", "api", "cron", "meta-leads", "route.ts")];
const META_SCOPE = [...listFiles("lib/meta-leads"), ...listFiles("app/api/webhooks/meta-leads"), ...listFiles("app/api/cron/meta-leads")];
const n = (p: string) => normalize(p);

describe("static: the only sender is the continuation path", () => {
  it("covers the code (not vacuous)", () => {
    expect(META_SCOPE.length).toBeGreaterThan(8);
    expect(META_SCOPE.map(n)).toContain(n("lib/meta-leads/continuation.ts"));
  });
  it("nothing under lib/meta-leads or the two routes names sendEmail or a sending package", () => {
    for (const f of META_SCOPE) {
      const src = stripComments(readFileSync(f, "utf8"));
      expect(src, f).not.toMatch(/sendEmail|@\/lib\/email|@\/lib\/sim-email|from ["']resend["']|nodemailer|twilio/);
    }
  });
  it("in the transitive closure, the email module is imported ONLY by the three reviewed portal/quote senders", () => {
    const closure = importClosure(ENTRIES);
    expect(closure.files.size).toBeGreaterThan(ENTRIES.length);
    expect(closure.files.has(n("lib/email.ts"))).toBe(true); // it IS reachable — through the portal, by design
    const importers = [...closure.files].filter((f) => importSpecifiers(readFileSync(f, "utf8"), f).some((s) => s === "@/lib/email")).sort();
    // Reviewed: quotes.ts = the STAFF "send quote" email (reached only via draft.ts's computeChargeStack import,
    // never called on the Meta path); draft.ts = the order-confirmation on submitDraft (a customer act, not the
    // worker); magic-link.ts = the continuation (the ONE Meta send). A fourth importer here is a new sender.
    expect(importers).toEqual([n("lib/catering/quotes.ts"), n("lib/portal/draft.ts"), n("lib/portal/magic-link.ts")]);
  });
  it("the portal mint is reached from exactly one Meta module, the continuation", () => {
    const closure = importClosure(ENTRIES);
    const minters = [...closure.files].filter((f) => f.startsWith(n("lib/meta-leads")) || f.startsWith(n("app/api")))
      .filter((f) => /mintAndSendPortalLink/.test(stripComments(readFileSync(f, "utf8")))).sort();
    expect(minters).toEqual([n("lib/meta-leads/continuation.ts")]);
    expect(stripComments(readFileSync(n("lib/meta-leads/worker.ts"), "utf8"))).not.toMatch(/mintAndSendPortalLink|requestMagicLink/);
  });
});
