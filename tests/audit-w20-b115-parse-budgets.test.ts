/**
 * Audit W20/B115 (review round 3, P2): every path that starts a receipt parse must only start one
 * its function can finish. The model call is bounded at PARSE_CALL_TIMEOUT_MS; a parse needs that
 * plus its downloads, write and matching (PARSE_ROW_RESERVE_MS). These drive the real webhook
 * route and the real admission check on a controlled clock, then pin each route's own limit.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ record: vi.fn(), process: vi.fn(), verify: vi.fn(), after: vi.fn(), parse: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/inbound-router", () => ({ recordInboundMessage: mocks.record, processInboundMessage: mocks.process }));
vi.mock("@/lib/webhook-verify-shared", () => ({ verifySvixSignature: mocks.verify }));
vi.mock("@/lib/receipt-parse", () => ({ parseReceipt: mocks.parse }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.service }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));

import { POST, maxDuration as webhookMaxDuration } from "@/app/api/webhooks/resend-inbound/route";
import { parseFetchedInboundMessage } from "@/lib/inbound-parse";
import {
  PARSE_CALL_TIMEOUT_MS, PARSE_HANDOFF_MS, PARSE_ROW_OVERHEAD_MS, PARSE_ROW_RESERVE_MS, ROUTE_TAIL_RESERVE_MS,
  fetchShareDeadline, parseFits, routeWorkDeadline,
} from "@/lib/receipt-parse-budget-shared";

const T0 = 1_800_000_000_000;
let now = T0;

/** The ledger lookup the admission check makes; `lookupMs` is how long it takes on the clock. */
function database(lookupMs = 0) {
  const chain = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => { now += lookupMs; return { data: { email_receipt_id: "receipt" }, error: null }; }),
  };
  const sb = { from: vi.fn(() => chain) };
  mocks.service.mockReturnValue(sb);
  return sb;
}

beforeEach(() => {
  vi.clearAllMocks();
  now = T0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture");
  vi.stubEnv("RESEND_INBOUND_SECRET", "fixture-secret");
  mocks.verify.mockReturnValue(true);
  mocks.record.mockResolvedValue({ duplicate: false, id: "inbound-row" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

/** One vendor email through the real webhook: the fetch takes `fetchMs`, a parse takes `parseMs`. */
async function deliver(fetchMs: number, parseMs: number) {
  database();
  mocks.process.mockImplementation(async () => { now += fetchMs; return "fetched"; });
  let finishedAt: number | null = null;
  mocks.parse.mockImplementation(async () => { now += parseMs; finishedAt = now; return { ok: true }; });
  const request = new NextRequest("https://app.example.test/api/webhooks/resend-inbound", {
    method: "POST", body: JSON.stringify({ type: "email.received", data: { email_id: "fixture-message" } }),
  });
  expect((await POST(request)).status).toBe(200);
  await mocks.after.mock.calls[0]![0]();
  return { admitted: mocks.parse.mock.calls.length === 1, finishedMs: finishedAt === null ? null : finishedAt - T0 };
}

describe("the mail webhook only starts a parse it can finish", () => {
  it("a 60-second fetch followed by a 130-second parse finishes inside the function's limit", async () => {
    const run = await deliver(60_000, 130_000);
    // A normal fetch must still get its immediate parse: that is the point of parsing here.
    expect(run.admitted).toBe(true);
    expect(run.finishedMs).toBeLessThanOrEqual(webhookMaxDuration * 1000);
  });

  it.each([0, 30_000, 60_000, 90_000, 110_000, 110_001, 130_000, 160_000, 200_000])(
    "after a %s ms fetch, a parse that uses its whole reserve is either finished in time or not started",
    async fetchMs => {
      const run = await deliver(fetchMs, PARSE_ROW_RESERVE_MS);
      if (run.admitted) expect(run.finishedMs).toBeLessThanOrEqual(webhookMaxDuration * 1000 - ROUTE_TAIL_RESERVE_MS);
      // The decision is the shared rule, nothing looser and nothing stricter.
      expect(run.admitted).toBe(parseFits(T0 + fetchMs, routeWorkDeadline(T0, webhookMaxDuration)));
    },
  );

  it("a fetch slow enough to leave less than one parse leaves the receipt to the sweep", async () => {
    const spare = routeWorkDeadline(0, webhookMaxDuration) - PARSE_ROW_RESERVE_MS;
    expect((await deliver(spare + 1, PARSE_ROW_RESERVE_MS)).admitted).toBe(false);
  });
});

describe("the admission check itself", () => {
  it("does not start a parse with 100 seconds left (the old 80-second rule did)", async () => {
    const sb = database();
    await parseFetchedInboundMessage("inbound-row", now + 100_000);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(sb.from).not.toHaveBeenCalled(); // no lookup either: nothing can come of it
  });

  it.each([[0, true], [-1, false]])("with the reserve %s ms: starts=%s", async (delta, starts) => {
    database();
    await parseFetchedInboundMessage("inbound-row", now + PARSE_ROW_RESERVE_MS + delta);
    expect(mocks.parse).toHaveBeenCalledTimes(starts ? 1 : 0);
  });

  it("checks again after the lookup, so a slow lookup cannot push a parse past the deadline", async () => {
    database(5_000);
    await parseFetchedInboundMessage("inbound-row", now + PARSE_ROW_RESERVE_MS + 4_999);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
function declaredMaxDuration(path: string): number {
  const declared = /^export const maxDuration = (\d+);/m.exec(read(path));
  expect(declared, `${path} declares maxDuration`).not.toBeNull();
  return Number(declared![1]);
}
/** One mail fetch with its storage writes: what lib/inbound-router.ts keeps free per message. */
const FETCH_WINDOW_MS = 60_000;

describe("one source for every parse budget", () => {
  it("the reserve is the call bound plus its overhead, nothing typed twice", () => {
    expect(PARSE_ROW_RESERVE_MS).toBe(PARSE_CALL_TIMEOUT_MS + PARSE_ROW_OVERHEAD_MS);
    expect(parseFits(0, PARSE_ROW_RESERVE_MS)).toBe(true);
    expect(parseFits(1, PARSE_ROW_RESERVE_MS)).toBe(false);
    expect(fetchShareDeadline(routeWorkDeadline(0, 300))).toBe(300_000 - ROUTE_TAIL_RESERVE_MS - PARSE_ROW_RESERVE_MS - PARSE_HANDOFF_MS);
  });

  it("the webhook's limit holds one mail fetch and then one whole parse", () => {
    const limit = declaredMaxDuration("app/api/webhooks/resend-inbound/route.ts");
    expect(limit).toBe(webhookMaxDuration);
    expect(routeWorkDeadline(0, limit) - PARSE_ROW_RESERVE_MS).toBeGreaterThanOrEqual(FETCH_WINDOW_MS);
    expect(limit).toBeLessThanOrEqual(300);
  });

  it("Parse now's limit holds one whole parse with the tail kept free", () => {
    const limit = declaredMaxDuration("app/api/operations/receiving/email-receipts/route.ts");
    expect(parseFits(0, routeWorkDeadline(0, limit))).toBe(true);
    expect(limit).toBeLessThanOrEqual(300);
  });

  it.each(["app/api/cron/parse-receipts/route.ts", "app/api/cron/toast-catering-scan/route.ts"])(
    "%s gives the sweep a fetch share that holds a fetch, and still one whole parse", path => {
      const deadline = routeWorkDeadline(0, declaredMaxDuration(path));
      expect(fetchShareDeadline(deadline)).toBeGreaterThanOrEqual(FETCH_WINDOW_MS);
      expect(parseFits(fetchShareDeadline(deadline) + PARSE_HANDOFF_MS, deadline)).toBe(true);
    },
  );

  it("no caller keeps a time budget of its own", () => {
    for (const path of ["lib/inbound-parse.ts", "lib/parse-receipts-run.ts", "app/api/webhooks/resend-inbound/route.ts", "app/api/cron/parse-receipts/route.ts"]) {
      const code = read(path).split("\n").filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
      expect(code, path).not.toMatch(/\d_000\b/);
    }
    expect(read("lib/receipt-parse.ts")).toContain("signal: AbortSignal.timeout(PARSE_CALL_TIMEOUT_MS)");
    expect(read("lib/receipt-parse.ts")).not.toMatch(/PARSE_CALL_TIMEOUT_MS = \d/);
  });

  it("the sweep and the webhook both ask the one shared question before a parse", () => {
    expect(read("lib/inbound-parse.ts")).toContain("parseFits(Date.now(), deadline)");
    expect(read("lib/parse-receipts-run.ts")).toContain("parseFits(Date.now(), deadline)");
  });
});
