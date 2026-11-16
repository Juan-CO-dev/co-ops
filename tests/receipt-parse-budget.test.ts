/**
 * Audit W20/B115: a long invoice needs a long model call. These pin the three budgets that have
 * to agree: the per-call bound, the time the cron keeps free before starting a row, and the
 * "Parse now" route's limit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/email-receipts", () => ({ matchReceiptToPo: vi.fn(), applyReceiptPoEffects: vi.fn(), attemptAutoLink: vi.fn(), EmailReceiptError: Error, RECEIPT_MIN: 4 }));
vi.mock("@/lib/inbound-router", () => ({ sweepInboundMessages: vi.fn() }));

import { PARSE_CALL_TIMEOUT_MS } from "@/lib/receipt-parse";
import { PARSE_ROW_RESERVE_MS, parseFits, routeWorkDeadline } from "@/lib/receipt-parse-budget-shared";
import { VENDOR_MAIL_FAILURE_CODES } from "@/lib/vendor-mail-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("long-invoice parse budgets", () => {
  it("the cron only starts a row with the whole call, and more, still in hand", () => {
    expect(PARSE_ROW_RESERVE_MS).toBeGreaterThan(PARSE_CALL_TIMEOUT_MS);
    // One full row always fits the 280 s sweep budget.
    expect(PARSE_ROW_RESERVE_MS).toBeLessThan(280_000);
    const run = read("lib/parse-receipts-run.ts");
    expect(run).toContain("if (!parseFits(Date.now(), deadline)) break;");
    expect(run).not.toContain("Date.now() + 80_000");
  });
  it("the model call uses the shared bound, not a literal", () => {
    const parse = read("lib/receipt-parse.ts");
    expect(parse).toContain("signal: AbortSignal.timeout(PARSE_CALL_TIMEOUT_MS)");
    expect(parse).not.toContain("AbortSignal.timeout(60_000)");
  });
  it("Parse now is given longer than the call can take", () => {
    const route = read("app/api/operations/receiving/email-receipts/route.ts");
    const declared = /export const maxDuration = (\d+);/.exec(route);
    expect(declared).not.toBeNull();
    expect(Number(declared![1]) * 1000).toBeGreaterThan(PARSE_CALL_TIMEOUT_MS);
    // Review r3: longer than the CALL was not enough; a whole parse must fit with the tail free.
    expect(parseFits(0, routeWorkDeadline(0, Number(declared![1])))).toBe(true);
    expect(Number(declared![1])).toBeLessThanOrEqual(300);
  });
  it("the new failure reason is in the closed list and worded in both languages", () => {
    expect(VENDOR_MAIL_FAILURE_CODES).toContain("truncated_output");
    for (const code of VENDOR_MAIL_FAILURE_CODES) {
      expect((en as Record<string, string>)[`vendorMail.failure.${code}`], code).toBeTruthy();
      expect((es as Record<string, string>)[`vendorMail.failure.${code}`], code).toBeTruthy();
    }
  });
});
