import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/email-receipts", () => ({ matchReceiptToPo: vi.fn(), applyReceiptPoEffects: vi.fn(), attemptAutoLink: vi.fn(), EmailReceiptError: Error, RECEIPT_MIN: 4 }));
import { parseReceipt } from "@/lib/receipt-parse";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("keeps the parser MIME gate byte-identical to base 6dc3e285", () => {
  const source = readFileSync("lib/receipt-parse.ts", "utf8").replace(/\r\n/g, "\n");
  const gate = source.split("    const base = t.contentType.split")[1]!.split("  return { assets, textFallbackForMatch };")[0]!;
  expect(createHash("sha256").update(gate).digest("hex")).toBe("f06defb528f8d9e5bb17f93999c43ad26cc459e8d151296de175d28637bc1f58");
});

it("skips archive extras and unsupported types before downloading, retaining the MIME note", async () => {
  const download = vi.fn(async () => ({ data: new Blob(["invoice"]), error: null }));
  const writes: Record<string, unknown>[] = [];
  const receipt = { id: "r", parse_state: "unparsed", raw_storage_path: null, attachment_paths: [
    { kind: "body", filename: "message.html", contentType: "text/html", path: "html" },
    { kind: "headers", filename: "headers.json", contentType: "application/json", path: "headers" },
    { filename: "sheet.xls", contentType: "application/vnd.ms-excel", path: "sheet" },
    { kind: "attachment", filename: "invoice.pdf", contentType: "application/pdf", path: "pdf" },
    { filename: "legacy.txt", contentType: "text/plain", path: "legacy" },
  ] };
  const q = { select: () => q, eq: () => q, update: (write: Record<string, unknown>) => { writes.push(write); return q; },
    maybeSingle: async () => ({ data: receipt, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, count: 1 }).then(resolve) };
  const sb = { from: () => q, storage: { from: () => ({ download }) } } as unknown as SupabaseClient;
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  await parseReceipt(sb, "r");
  expect(download.mock.calls).toEqual([["pdf"], ["legacy"]]);
  expect(writes[0]).toMatchObject({ parsed_json: { notes: ["unsupported_type_skipped:sheet.xls:application/vnd.ms-excel"] } });
});
